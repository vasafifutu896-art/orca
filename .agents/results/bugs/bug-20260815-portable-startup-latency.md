# Windows portable startup was extremely slow

Status: fixed and released in portable multi-instance `.10`; Windows artifact benchmark passed

## Reported behavior

- The portable executable appeared not to start, then eventually opened after a long delay.
- Starting several Orca windows made the delay and reliability problem more noticeable.

## Root cause

The `.7` portable executable contained a 137,981,357-byte solid LZMA archive that expanded to
629,681,143 bytes across 3,078 files. The stock electron-builder portable path first extracted
that archive into a staging directory and then copied the full runtime into the execution
directory. Every Orca window therefore performed roughly 1.4 GB of temporary writes before the
application could start, in addition to Windows antivirus scanning the unsigned payload.

The configured `unpackDirName: false` also did not have the behavior claimed by its comment.
electron-builder 26.15.3 maps `false` to one build-time-generated `%TEMP%` directory. Concurrent
portable launches could both remove and overwrite that same runtime. In this pinned builder
version, `true` leaves the unpack directory undefined and the NSIS template uses a unique
`$PLUGINSDIR` for each launch.

This was not introduced by the `.7` notification-focus fix. The `.6` to `.7` runtime diff only
changed code reached after a notification click, and the two artifacts are effectively the same
size.

## Fix

- Enabled electron-builder's `useZip` portable mode so NSIS decompresses the application directly
  into its final temporary execution directory instead of staging a 7z and copying 630 MB again.
- Switched `unpackDirName` to `true`, which is the concurrency-safe per-launch behavior in the
  pinned electron-builder 26.15.3 implementation.
- Added artifact-structure verification so a future packaging change cannot silently restore the
  nested `app-64.7z`/`nsis7z.dll` path.
- Added an optional folder-portable ZIP. Its `.orca-portable` marker keeps `OrcaData` and the
  relocated terminal daemon beside the extracted application, while direct `Orca.exe` launches
  avoid all per-window self-extraction.
- Added a Windows visible-window benchmark that launches both the `.7` baseline and candidate,
  measures outer-EXE-to-visible-window time, and keeps the first window alive while launching a
  second instance.

## Evidence

Local package extraction measurements using the same `.7` runtime:

| Portable layout      |   Executable size | Runtime extraction | Extra full-runtime copy |
| -------------------- | ----------------: | -----------------: | ----------------------- |
| `.7` nested solid 7z | 138,377,700 bytes |      5.567 seconds | Yes                     |
| Direct NSIS zlib     | 229,206,690 bytes |      3.631 seconds | No                      |
| Direct NSIS store    | 620,723,552 bytes |      0.680 seconds | No                      |

The zlib layout is the selected balance: it removes the duplicate write and reduced local
extraction time by about 35%, while avoiding a 621 MB download. Windows Defender and disk behavior
can change the absolute result, so the release workflow records the actual visible-window timing
on `windows-2022` rather than treating the Linux extraction number as a user-facing startup time.

The `.10` Windows 2022 release run measured three alternating baseline/candidate pairs:

| Launch with first window retained | `.7` median | `.10` median | Reduction |
| --------------------------------- | ----------: | -----------: | --------: |
| First visible window              |    44.853 s |     19.504 s |     56.5% |
| Second visible window             |    49.209 s |     22.000 s |     55.3% |

All first and second windows appeared in 3/3 runs, every first window survived the concurrent
launch, and benchmark cleanup passed. The verified `.10` single-file artifact is 229,204,304 bytes;
the optional folder-portable ZIP is 239,421,463 bytes. Full raw results are attached to the release
as `portable-startup-benchmark.json`.

## Remaining limitation

A single-file portable must still extract its runtime for every concurrently running instance.
The optimized path makes that extraction one-pass and collision-free; users who prioritize repeat
startup speed can use the folder-portable ZIP instead. Authenticode signing would also reduce the
risk of additional SmartScreen and Defender delay, but the current portable release workflow has
no signing credentials.
