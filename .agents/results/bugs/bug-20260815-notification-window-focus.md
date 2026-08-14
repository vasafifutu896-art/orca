# Notification click did not foreground its Orca window on Windows

Status: fixed and regression-tested

## Reported behavior

- Clicking an Orca completion notification while another app or Orca instance was in front did not reliably activate the window associated with that notification.
- The problem was easier to notice with several portable Orca instances running at once.

## Root cause

The native notification click handler correctly resolved the trusted main window inside the process that created the notification and sent the worktree and terminal-pane navigation events to it. However, that handler duplicated only `restore()`, `show()`, and `focus()`.

Orca's existing Windows window-activation path also calls `app.focus()`, raises the window in the z-order, briefly pulses always-on-top, and retries focus after 100 ms. The notification path bypassed those Windows reinforcements, so it could lose the foreground race to the currently active application or Orca process.

## Fix

- Exported the existing reinforced activation routine as `activateExistingWindow`.
- Reused it from both the normal existing-window path and native-notification click handling.
- Kept worktree and exact terminal-pane navigation after the window activation request.
- Left the packaged AppUserModelID unchanged: live notification callbacks and trusted-window selection are process-local, so per-instance Windows notification identities are not needed for this bug.

## Regression evidence

- A Windows-specific notification test failed before the fix because `app.focus()` was never called.
- The test now verifies `app.focus({ steal: true })`, minimized-window restore, `show()`, `focus()`, `moveTop()`, the temporary always-on-top pulse, and the 100 ms focus retry.
- Existing tests continue to verify that dashboard popouts are not focused and that clicks navigate to the exact originating terminal pane.
