[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Baseline,
  [Parameter(Mandatory = $true)][string]$Candidate,
  [ValidateRange(1, 20)][int]$Iterations = 3,
  [ValidateRange(1, 600)][int]$TimeoutSec = 90,
  [ValidateRange(10, 5000)][int]$PollMs = 50,
  [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This benchmark requires Windows.' }

$enumScript = Join-Path $PSScriptRoot '..\win-update-e2e\window-enum.ps1'
if (-not (Test-Path -LiteralPath $enumScript -PathType Leaf)) {
  throw "Window enumerator not found: $enumScript"
}
. $enumScript

function Resolve-Exe([string]$Path, [string]$Label) {
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($item.PSIsContainer) { throw "$Label is not a file: $Path" }
  return $item.FullName
}

function Get-OrcaWindows {
  return @(Get-VisibleTopLevelWindows | Where-Object { $_.processName -ieq 'Orca' })
}

function Test-VisibleWindow([object]$Window, [object[]]$Windows) {
  if ($null -eq $Window) { return $false }
  return @($Windows | Where-Object {
    [long]$_.handle -eq [long]$Window.handle -and [int]$_.pid -eq [int]$Window.pid
  }).Count -gt 0
}

function Get-Lineage([int]$OwnerProcessId, [int]$WrapperProcessId) {
  $byProcessId = @{}
  foreach ($record in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $byProcessId[[int]$record.ProcessId] = $record
  }
  $chain = New-Object 'System.Collections.Generic.List[int]'
  $seen = New-Object 'System.Collections.Generic.HashSet[int]'
  $currentProcessId = $OwnerProcessId
  while ($currentProcessId -gt 0 -and $seen.Add($currentProcessId)) {
    $chain.Add($currentProcessId)
    if ($currentProcessId -eq $WrapperProcessId) {
      return [pscustomobject]@{
        valid = $true
        chain = @($chain.ToArray())
        executablePath = $byProcessId[$OwnerProcessId].ExecutablePath
      }
    }
    if (-not $byProcessId.ContainsKey($currentProcessId)) { break }
    $currentProcessId = [int]$byProcessId[$currentProcessId].ParentProcessId
  }
  return [pscustomobject]@{ valid = $false; chain = @($chain.ToArray()); executablePath = $null }
}

function New-Metric(
  [string]$Outcome,
  [double]$ElapsedMs,
  [AllowNull()][object]$Outer,
  [AllowNull()][object]$Window,
  [AllowNull()][object]$Lineage,
  [AllowNull()][object]$RequiredWindowSurvived,
  [AllowNull()][string]$ErrorMessage
) {
  return [pscustomobject][ordered]@{
    outcome = $Outcome
    visibleMs = if ($Outcome -eq 'visible') { [math]::Round($ElapsedMs, 1) } else { $null }
    elapsedMs = [math]::Round($ElapsedMs, 1)
    wrapperPid = if ($null -ne $Outer) { $Outer.Id } else { $null }
    window = if ($null -ne $Window) {
      [pscustomobject]@{
        handle = [long]$Window.handle
        pid = [int]$Window.pid
        title = [string]$Window.title
        executablePath = $Lineage.executablePath
        descendantChain = @($Lineage.chain)
      }
    } else { $null }
    requiredWindowVisibleThroughout = $RequiredWindowSurvived
    error = $ErrorMessage
  }
}

function Measure-Launch(
  [System.Diagnostics.ProcessStartInfo]$StartInfo,
  [int]$TimeoutMs,
  [int]$PollIntervalMs,
  [AllowNull()][object]$RequiredWindow
) {
  $excluded = New-Object 'System.Collections.Generic.HashSet[long]'
  foreach ($window in @(Get-OrcaWindows)) { [void]$excluded.Add([long]$window.handle) }
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try { $outer = [System.Diagnostics.Process]::Start($StartInfo) } catch {
    $stopwatch.Stop()
    $survived = if ($null -ne $RequiredWindow) {
      Test-VisibleWindow $RequiredWindow @(Get-OrcaWindows)
    } else { $null }
    return [pscustomobject]@{
      outer = $null
      metric = New-Metric 'spawn-error' $stopwatch.Elapsed.TotalMilliseconds `
        $null $null $null $survived $_.Exception.Message
    }
  }

  $rejected = New-Object 'System.Collections.Generic.HashSet[long]'
  $survived = if ($null -ne $RequiredWindow) { $true } else { $null }
  while ($stopwatch.ElapsedMilliseconds -lt $TimeoutMs) {
    $windows = @(Get-OrcaWindows)
    if ($null -ne $RequiredWindow -and -not (Test-VisibleWindow $RequiredWindow $windows)) {
      $survived = $false
    }
    foreach ($window in $windows) {
      $handle = [long]$window.handle
      if ($excluded.Contains($handle) -or $rejected.Contains($handle)) { continue }
      $observedMs = $stopwatch.Elapsed.TotalMilliseconds
      $lineage = Get-Lineage ([int]$window.pid) $outer.Id
      if ($lineage.valid) {
        if ($null -ne $RequiredWindow -and
            -not (Test-VisibleWindow $RequiredWindow @(Get-OrcaWindows))) { $survived = $false }
        $stopwatch.Stop()
        return [pscustomobject]@{
          outer = $outer
          metric = New-Metric 'visible' $observedMs $outer $window $lineage $survived $null
        }
      }
      [void]$rejected.Add($handle)
    }
    try { $outerExited = $outer.HasExited } catch { $outerExited = $true }
    if ($outerExited) {
      $stopwatch.Stop()
      return [pscustomobject]@{
        outer = $outer
        metric = New-Metric 'outer-exit' $stopwatch.Elapsed.TotalMilliseconds `
          $outer $null $null $survived 'Wrapper exited before a descendant window appeared.'
      }
    }
    Start-Sleep -Milliseconds $PollIntervalMs
  }
  $stopwatch.Stop()
  return [pscustomobject]@{
    outer = $outer
    metric = New-Metric 'timeout' $stopwatch.Elapsed.TotalMilliseconds $outer $null $null `
      $survived "No descendant Orca window appeared within $TimeoutMs ms."
  }
}

function Assert-RunRoot([string]$RunRoot, [string]$BenchmarkRoot) {
  $root = [System.IO.Path]::GetFullPath($BenchmarkRoot).TrimEnd('\', '/')
  $path = [System.IO.Path]::GetFullPath($RunRoot).TrimEnd('\', '/')
  $parent = [System.IO.Path]::GetDirectoryName($path).TrimEnd('\', '/')
  [guid]$parsed = [guid]::Empty
  if (-not [string]::Equals($root, $parent, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not [guid]::TryParseExact([System.IO.Path]::GetFileName($path), 'D', [ref]$parsed)) {
    throw "Refusing cleanup outside a GUID-scoped run root: $path"
  }
  if (((Get-Item -LiteralPath $path).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing cleanup through a reparse point: $path"
  }
  return $path
}

function New-RunContext([string]$SourceExe, [string]$BenchmarkRoot) {
  $runId = [guid]::NewGuid().ToString('D')
  $runRoot = Join-Path $BenchmarkRoot $runId
  New-Item -ItemType Directory -Path $runRoot | Out-Null
  try {
    $exe = Join-Path $runRoot 'orca-windows-portable.exe'
    Copy-Item -LiteralPath $SourceExe -Destination $exe
    $environment = [ordered]@{
      TEMP = Join-Path $runRoot 'temp'; TMP = Join-Path $runRoot 'temp'
      USERPROFILE = Join-Path $runRoot 'profile'
      APPDATA = Join-Path $runRoot 'appdata\roaming'
      LOCALAPPDATA = Join-Path $runRoot 'appdata\local'
    }
    foreach ($path in @($environment.Values | Select-Object -Unique)) {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $exe
    $startInfo.WorkingDirectory = $runRoot
    $startInfo.UseShellExecute = $false
    foreach ($key in @(
      'ORCA_E2E_USER_DATA_DIR', 'ORCA_E2E_HOME_DIR', 'ORCA_E2E_HEADLESS',
      'ORCA_DISABLE_MULTI_INSTANCE', 'ELECTRON_RUN_AS_NODE',
      'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_FILE',
      'PORTABLE_EXECUTABLE_APP_FILENAME', 'HOME'
    )) { $startInfo.EnvironmentVariables.Remove($key) }
    foreach ($entry in $environment.GetEnumerator()) {
      $startInfo.EnvironmentVariables[$entry.Key] = $entry.Value
    }
    return [pscustomobject]@{ id = $runId; root = $runRoot; startInfo = $startInfo }
  } catch {
    $safeRoot = Assert-RunRoot $runRoot $BenchmarkRoot
    Remove-Item -LiteralPath $safeRoot -Recurse -Force
    throw
  }
}

function Test-Scoped([object]$Record, [string]$RunRoot) {
  foreach ($text in @($Record.ExecutablePath, $Record.CommandLine)) {
    if ($text -and $text.IndexOf($RunRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
      return $true
    }
  }
  return $false
}

function Stop-Tree([int]$ProcessId) {
  try {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    $info.Arguments = "/PID $ProcessId /T /F"
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::Start($info)
    $process.WaitForExit()
  } catch { Write-Warning "taskkill failed for PID ${ProcessId}: $($_.Exception.Message)" }
}

function Clear-Run([object]$Context, [object[]]$Outers, [int[]]$InnerProcessIds, [string]$BenchmarkRoot) {
  $runRoot = Assert-RunRoot $Context.root $BenchmarkRoot
  $records = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  foreach ($innerProcessId in @($InnerProcessIds | Sort-Object -Unique)) {
    $record = @($records | Where-Object { [int]$_.ProcessId -eq $innerProcessId }) | Select-Object -First 1
    if ($null -ne $record -and (Test-Scoped $record $runRoot)) { Stop-Tree $innerProcessId }
  }
  $deadline = [datetime]::UtcNow.AddSeconds(15)
  while ([datetime]::UtcNow -lt $deadline) {
    $alive = @($Outers | Where-Object { try { -not $_.HasExited } catch { $false } })
    if ($alive.Count -eq 0) { break }
    Start-Sleep -Milliseconds 200
  }
  foreach ($outer in @($Outers)) {
    try { if (-not $outer.HasExited) { Stop-Tree $outer.Id } } catch { }
    if ($null -ne $outer) { $outer.Dispose() }
  }
  for ($pass = 0; $pass -lt 4; $pass += 1) {
    $scoped = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { [int]$_.ProcessId -ne $PID -and (Test-Scoped $_ $runRoot) })
    if ($scoped.Count -eq 0) { break }
    foreach ($record in $scoped) { Stop-Tree ([int]$record.ProcessId) }
    Start-Sleep -Milliseconds 250
  }
  $lastError = $null
  for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
    try {
      if (Test-Path -LiteralPath $runRoot) {
        Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction Stop
      }
      if (-not (Test-Path -LiteralPath $runRoot)) {
        return [pscustomobject]@{ succeeded = $true; error = $null }
      }
    } catch { $lastError = $_.Exception.Message }
    Start-Sleep -Milliseconds 500
  }
  return [pscustomobject]@{ succeeded = $false; error = $lastError }
}

function Not-Run([string]$Reason) {
  return [pscustomobject]@{ outcome = 'not-run'; visibleMs = $null; elapsedMs = 0
    wrapperPid = $null; window = $null; requiredWindowVisibleThroughout = $null; error = $Reason }
}

function Invoke-Scenario(
  [string]$Label, [string]$SourceExe, [int]$Iteration, [int]$Order,
  [string]$BenchmarkRoot, [int]$TimeoutMs, [int]$PollIntervalMs
) {
  $context = New-RunContext $SourceExe $BenchmarkRoot
  $outers = @(); $innerProcessIds = @()
  $result = [ordered]@{
    label = $Label; iteration = $Iteration; order = $Order; runId = $context.id
    first = Not-Run 'setup'; second = Not-Run 'first window missing'
    firstWindowSurvived = $false; passed = $false; failures = @(); cleanup = $null
  }
  try {
    $first = Measure-Launch $context.startInfo $TimeoutMs $PollIntervalMs $null
    if ($null -ne $first.outer) { $outers += $first.outer }
    $result.first = $first.metric
    if ($first.metric.outcome -eq 'visible') {
      $innerProcessIds += [int]$first.metric.window.pid
      $second = Measure-Launch $context.startInfo $TimeoutMs $PollIntervalMs $first.metric.window
      if ($null -ne $second.outer) { $outers += $second.outer }
      $result.second = $second.metric
      if ($second.metric.outcome -eq 'visible') { $innerProcessIds += [int]$second.metric.window.pid }
      $result.firstWindowSurvived = $second.metric.requiredWindowVisibleThroughout -eq $true -and
        (Test-VisibleWindow $first.metric.window @(Get-OrcaWindows))
    }
    $failures = @()
    if ($result.first.outcome -ne 'visible') { $failures += "first=$($result.first.outcome)" }
    if ($result.second.outcome -ne 'visible') { $failures += "second=$($result.second.outcome)" }
    if (-not $result.firstWindowSurvived) { $failures += 'first-window-lost' }
    $result.failures = $failures
    $result.passed = $failures.Count -eq 0
  } catch {
    $result.failures = @("harness-error=$($_.Exception.Message)")
  } finally {
    try { $result.cleanup = Clear-Run $context $outers $innerProcessIds $BenchmarkRoot } catch {
      $result.cleanup = [pscustomobject]@{ succeeded = $false; error = $_.Exception.Message }
    }
  }
  return [pscustomobject]$result
}

function Median([object[]]$Values) {
  $values = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
  if ($values.Count -eq 0) { return $null }
  $middle = [math]::Floor($values.Count / 2)
  if ($values.Count % 2) { return [math]::Round([double]$values[$middle], 1) }
  return [math]::Round(([double]$values[$middle - 1] + [double]$values[$middle]) / 2, 1)
}

function Summarize([string]$Label, [object[]]$Scenarios) {
  $runs = @($Scenarios | Where-Object { $_.label -eq $Label })
  return [pscustomobject]@{
    runs = $runs.Count
    firstVisible = @($runs | Where-Object { $_.first.outcome -eq 'visible' }).Count
    secondVisible = @($runs | Where-Object { $_.second.outcome -eq 'visible' }).Count
    firstSurvived = @($runs | Where-Object { $_.firstWindowSurvived }).Count
    firstMedianMs = Median @($runs | ForEach-Object { $_.first.visibleMs })
    secondMedianMs = Median @($runs | ForEach-Object { $_.second.visibleMs })
  }
}

$baselineExe = Resolve-Exe $Baseline 'Baseline'
$candidateExe = Resolve-Exe $Candidate 'Candidate'
$benchmarkRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'orca-portable-window-bench'
New-Item -ItemType Directory -Path $benchmarkRoot -Force | Out-Null
$sources = @{ baseline = $baselineExe; candidate = $candidateExe }
$scenarios = @(); $timeoutMs = $TimeoutSec * 1000
for ($iteration = 1; $iteration -le $Iterations; $iteration += 1) {
  $labels = if ($iteration % 2) { @('baseline', 'candidate') } else { @('candidate', 'baseline') }
  for ($order = 1; $order -le 2; $order += 1) {
    $label = $labels[$order - 1]
    Write-Host "[portable-window-bench] pair=$iteration order=$order label=$label"
    $scenario = Invoke-Scenario $label $sources[$label] $iteration $order `
      $benchmarkRoot $timeoutMs $PollMs
    $scenarios += $scenario
    if ($label -eq 'baseline' -and -not $scenario.passed) {
      Write-Warning "Baseline pair $iteration reported: $($scenario.failures -join ', ')"
    }
  }
}

$candidateFailures = @($scenarios | Where-Object { $_.label -eq 'candidate' -and -not $_.passed })
$cleanupFailures = @($scenarios | Where-Object { $null -eq $_.cleanup -or -not $_.cleanup.succeeded })
$report = [pscustomobject][ordered]@{
  schemaVersion = 1; generatedAtUtc = [datetime]::UtcNow.ToString('o')
  settings = @{ iterations = $Iterations; timeoutMs = $timeoutMs; pollMs = $PollMs }
  artifacts = @{
    baseline = @{ path = $baselineExe; sha256 = (Get-FileHash $baselineExe -Algorithm SHA256).Hash.ToLowerInvariant() }
    candidate = @{ path = $candidateExe; sha256 = (Get-FileHash $candidateExe -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  summary = @{ baseline = Summarize 'baseline' $scenarios; candidate = Summarize 'candidate' $scenarios }
  candidatePassed = $candidateFailures.Count -eq 0
  cleanupPassed = $cleanupFailures.Count -eq 0
  scenarios = $scenarios
}

if (-not $OutputPath) {
  $OutputPath = Join-Path $benchmarkRoot "result-$([datetime]::UtcNow.ToString('yyyyMMdd-HHmmss')).json"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path (Get-Location).Path $OutputPath
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($OutputPath)) -Force | Out-Null
[System.IO.File]::WriteAllText($OutputPath, ($report | ConvertTo-Json -Depth 10) + "`n")

function Ms([object]$Value) { if ($null -eq $Value) { return 'n/a' }; return "$Value ms" }
$lines = @(
  '## Windows portable startup-to-window benchmark', '',
  '| Build | First visible | First median | Second visible | Second median | First survived |',
  '|---|---:|---:|---:|---:|---:|'
)
foreach ($label in @('baseline', 'candidate')) {
  $summary = $report.summary[$label]
  $lines += "| $label | $($summary.firstVisible)/$Iterations | $(Ms $summary.firstMedianMs) | " +
    "$($summary.secondVisible)/$Iterations | $(Ms $summary.secondMedianMs) | $($summary.firstSurvived)/$Iterations |"
}
$lines += @('', "Candidate gate: **$(if ($report.candidatePassed) { 'PASS' } else { 'FAIL' })**", '',
  "JSON: ``$OutputPath``")
$markdown = ($lines -join "`n") + "`n"
Write-Host $markdown
if ($env:GITHUB_STEP_SUMMARY) {
  [System.IO.File]::AppendAllText($env:GITHUB_STEP_SUMMARY, $markdown)
}
Write-Host "[portable-window-bench] JSON written to $OutputPath"

if ($candidateFailures.Count -gt 0 -or $cleanupFailures.Count -gt 0) {
  $candidateText = @($candidateFailures | ForEach-Object {
    "candidate pair $($_.iteration): $($_.failures -join ', ')"
  }) -join ' | '
  throw "Portable benchmark failed. $candidateText cleanupFailures=$($cleanupFailures.Count)"
}
