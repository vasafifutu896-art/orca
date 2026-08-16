# Bug: Terminal Manager Omits Server and Working Folder

**Date Reported**: 2026-08-17
**Date Fixed**: 2026-08-17
**Reporter**: User
**Assignee**: Codex
**Severity**: HIGH
**Status**: FIXED

## Problem Description

Terminal Manager session rows were intended to show a compact working-directory line below the
session title. Restored, cold, floating, and some direct-SSH sessions instead rendered only the
title. The row also did not show the SSH server address, so similarly named sessions could not be
distinguished by host.

Expected behavior is a stable two-line row:

```text
noonoo
203.0.113.42 · …/projects/noonoo
```

The server and location line must remain visible while live CWD resolution is pending.

## Evidence

User reference screenshot: `/home/imageshare/uploads/rPgzJ3Iz.png`.

The screenshot showed a full-height Terminal Manager row with no second-line element. Static trace
confirmed that this occurs only when `workingDirectory` resolves to `null`, because the component
conditionally removed the entire metadata line.

## Root Cause

- `useTerminalManagerWorkingDirectories` resolved PTYs only from `ptyIdsByTabId`.
- It ignored the retained `TerminalTab.ptyId` and `lastKnownRelayPtyIdByTabId` used by restored and
  cold direct-SSH sessions.
- With no resolved PTY, the hook did not poll `pty:getCwd`.
- Floating or temporarily unresolved workspaces could also have no workspace-path fallback.
- `TerminalManagerSessionButton` rendered no second line when CWD was `null`.
- SSH target hydration preserved only the friendly label and discarded `SshTarget.host`, so the
  actual server IP/hostname was unavailable to the row.
- The workspace lookup did not use proven execution-host ownership, which could select the wrong
  path when workspace IDs collide across hosts.

## Solution

- Resolve the current session PTY from the live binding, retained tab PTY, then last-known relay PTY.
- Poll current CWD for retained local and SSH sessions instead of dropping them from the target set.
- Resolve the active workspace only with hydrated execution-host ownership, while retaining an
  unscoped fallback during catalog hydration.
- Preserve configured SSH host/IP metadata during target hydration and remove it with target state.
- Resolve the displayed host per session from the PTY first, then the workspace execution host.
- Show runtime endpoint hostnames and `localhost` for local terminals.
- Always render `host · folder`; use an ellipsis only during the brief unresolved interval.
- Keep the full host and path in the row tooltip and accessible description.

No persisted-session or settings migration is required.

## Verification

- Unit tests cover exact SSH-PTY host precedence, SSH host/label fallback, runtime and local hosts,
  null-to-live CWD updates, compact/full path rendering, and retained-PTY polling.
- SSH store tests cover host refresh, stable metadata identity, and target cleanup.
- Portable boundary tests pass: 550 tests across 38 suites, with 11 platform-only skips locally.
- The real Electron Terminal Manager scenario passes, including location rendering, rename focus,
  multi-selection, drag/drop, group rename, collapse, and activation.
- Web/node/CLI type checks, scoped native and React lint, formatting, localization checks,
  max-lines ratchet, and diff checks pass.

## Prevention

- Do not conditionally remove identity metadata because a live provider value is temporarily absent.
- Treat retained PTY identities as valid inspection candidates; provider lookup can fail closed.
- Preserve display-safe connection metadata needed by compact session surfaces during hydration.
- Keep an Electron assertion for the actual second-line location element, not only helper tests.
