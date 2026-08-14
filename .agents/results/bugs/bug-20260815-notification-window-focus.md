# Notification click did not foreground its Orca window on Windows

Status: live cross-process fix implemented and regression-tested; Windows artifact/toast smoke pending

## Reported behavior

- Clicking an Orca completion notification while another app or Orca instance was in front did not reliably activate the window associated with that notification.
- The problem was easier to notice with several portable Orca instances running at once.

## First root cause fixed in `.7`

The native notification click handler correctly resolved the trusted main window inside the process that created the notification and sent the worktree and terminal-pane navigation events to it. However, that handler duplicated only `restore()`, `show()`, and `focus()`.

Orca's existing Windows window-activation path also calls `app.focus()`, raises the window in the z-order, briefly pulses always-on-top, and retries focus after 100 ms. The notification path bypassed those Windows reinforcements, so it could lose the foreground race to the currently active application or Orca process.

## Remaining root cause reproduced after `.7`

All packaged Orca slots share the `com.stablyai.orca` AppUserModelID and the same Electron-managed
`Orca.lnk` toast activator. Electron 43 adopts the existing shortcut's ToastActivatorCLSID in
every process and registers that COM activator with `REGCLS_MULTIPLEUSE`. Windows can therefore
deliver an Action Center activation to a different live Orca process from the one that created
the toast.

The `.7` handler only strengthened whichever process received the callback. It had no stable
owner identifier or cross-process relay, so a wrongly delivered activation could still focus the
wrong Orca window. The previous claim that all live notification callbacks are necessarily
process-local was incomplete: it applies to the in-memory notification-object callback, not the
shared Windows COM activation path.

## `.7` fix

- Exported the existing reinforced activation routine as `activateExistingWindow`.
- Reused it from both the normal existing-window path and native-notification click handling.
- Kept worktree and exact terminal-pane navigation after the window activation request.

## Cross-process fix

- Give each live Orca process a random notification-owner token and a private Windows named-pipe
  relay.
- Put only the owner token and a one-time route ID in the toast activation arguments; worktree
  paths remain in the owner process.
- Register Electron's global Windows activation callback. A callback received by the wrong Orca
  process relays the route ID to the owner and never focuses the receiver.
- Use a two-phase pipe handshake: the owner validates the one-time route and returns its PID; the
  receiving process grants that PID Windows foreground permission in-process, then commits the
  route. The owner does not focus or navigate before commit.
- Ship a small first-party N-API addon that follows Chromium's notification handoff sequence
  (`SendInput` with a zero-key pair, then `AllowSetForegroundWindow(ownerPid)`). A child EXE or
  PowerShell helper cannot safely substitute because foreground permission belongs to the COM
  callback process.
- Consume the route once across the notification-object callback, global callback, and pipe
  callback, then activate the trusted owner window and exact worktree/terminal pane.
- Treat stale toasts whose owner process has exited as no-ops so a reused instance slot cannot
  open an unrelated session.
- Focus the owner window immediately even during renderer reload, but queue worktree/pane
  navigation until IPC listeners, session hydration, and terminal reconnection are ready. Multiple
  queued clicks flush in click order rather than toast-creation order.
- If foreground permission is denied or the addon cannot load, still commit only to the validated
  owner and use Orca's reinforced restore/show/topmost path; the wrong receiver remains untouched.

## Existing regression evidence

- A Windows-specific notification test failed before the fix because `app.focus()` was never called.
- The test now verifies `app.focus({ steal: true })`, minimized-window restore, `show()`, `focus()`, `moveTop()`, the temporary always-on-top pulse, and the 100 ms focus retry.
- Existing tests continue to verify that dashboard popouts are not focused and that clicks navigate to the exact originating terminal pane.

## New regression evidence

- Activation delivered to slot 1 for a slot 2 toast must never focus or navigate slot 1 and must
  relay exactly once to the owner.
- The owner must activate the exact repo, worktree, tab, and leaf after receiving the relay.
- The in-memory click event and global Windows activation callback must be deduplicated.
- Korean text, Windows paths, XML metacharacters, invalid payloads, oversized payloads, and stale
  route IDs must be handled safely.

The portable-release boundary now passes 283 targeted tests, with four Windows-only native/pipe
checks skipped on Linux. Node and renderer typechecks, formatting, and relevant lint checks also
pass. The Windows workflow compiles and loads the N-API addon in both Node and Electron and runs
the real named-pipe checks.

The remaining release-evidence gap is an actual Windows Action Center smoke with two freshly built
`.8` processes: unit tests deterministically simulate the wrong-receiver-to-owner relay but cannot
make the Windows shell choose a specific COM recipient or observe the final foreground HWND.

## Scope boundary

This fix guarantees routing between live `.8` processes running at the same Windows integrity
level. A toast clicked after every owner process has exited is intentionally fail-closed rather
than opening an arbitrary Orca window. Full cold Action Center activation for the single-file
portable needs a stable COM activator because Electron currently registers the temporary extracted
inner executable, which is deleted when the portable wrapper exits. Administrator and normal-user
instances mixed together are also outside this release's guarantee because Windows pipe/UIPI rules
can deny the foreground handoff.
