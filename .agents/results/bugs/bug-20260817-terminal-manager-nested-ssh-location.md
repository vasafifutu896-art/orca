# Bug: Terminal Manager Loses the Inner Host and Folder During Nested SSH

**Date Reported**: 2026-08-17
**Date Fixed**: 2026-08-17
**Reporter**: User
**Assignee**: Codex
**Severity**: HIGH
**Status**: FIXED

## Problem Description

The Terminal Manager correctly follows the live folder on a directly connected SSH server, but
when that terminal starts another interactive `ssh` session, the row continues to show the first
server and its local SSH-client directory. It does not show the innermost server and directory.

Expected behavior is to show the latest inner terminal location when the inner shell reports one,
and to return to the outer server immediately after the nested SSH client exits.

## Reproduction Steps

1. Open an Orca direct-SSH terminal connected to server A.
2. From that terminal, run `ssh server-b`.
3. On server B, change to another directory.
4. Open Terminal Manager.
5. Observe server A and A's SSH-client CWD instead of server B and B's current folder.

**Frequency**: consistent because the direct-SSH provider result currently has unconditional
precedence over terminal-reported CWD state.

## Evidence

- The relay `pty.getCwd` request inspects processes on server A. While nested SSH is active, the
  foreground process is A's `ssh` client, so its kernel CWD is still on A and cannot describe B.
- OSC 7 emitted by B reaches the terminal, but the renderer parser discards the URI hostname and
  the Terminal Manager overwrites its path with A's provider CWD.
- Common Linux interactive shells may also report `user@host: path` through an OSC title; that
  structured location is currently used only as a display title and not retained as location data.

## Root Cause

The live-location model assumed every provider CWD belongs to the same machine as the terminal
session. That is true for a direct shell or foreground agent on server A, but false once the
foreground process is an SSH transport carrying a shell on server B. The model also failed to bind
terminal-reported location signals to the foreground process instance that produced them, so it
could not safely distinguish a stale outer prompt from a current inner prompt.

## Solution

The relay now exposes a structured, capability-versioned terminal-location probe. It keeps the
validated outer CWD separate from foreground-process identity and binds bounded OSC 7 or
conservative shell-title observations to the exact foreground SSH epoch. The renderer displays the
trusted transport host alongside the reported nested host, polls active/nested SSH sessions on a
bounded two-second cadence, restores the outer location after SSH exits, and rejects stale results
after PTY or connection-generation changes.

Older relays fall back to the original CWD API. Inner host/path observations remain display-only;
they never become file, execution, upload, or routing authority.

## Verification

- Final tracker/renderer integration suite: 5 files, 190 tests passed.
- Windows-workflow-equivalent Vitest suite: 47 files passed, 1 platform-skipped; 870 tests passed
  and 11 platform-specific tests skipped on Linux.
- Terminal Manager Electron E2E passed, including the two-line location row and rename/selection
  interaction coverage.
- Node and renderer TypeScript checks passed with Node 24.
- Changed-code native, type-aware, and React quality gates passed with zero new findings.
- Relay bundles built successfully for all configured OS/architecture targets and WSL.
- Windows portable CI now includes the new observation, foreground probe, relay tracker, provider,
  and Terminal Manager regression suites.

Known physical limit: the outer machine cannot infer an inner shell's live CWD if that shell emits
neither OSC 7 nor a recognizable title. In that case Orca shows an unknown path instead of falsely
labeling the outer SSH client's folder as the inner folder. For three or more SSH hops, returning
from the deepest hop likewise requires the resumed shell to emit a fresh location signal.

## Prevention

- Keep transport-host authority separate from untrusted terminal display hints.
- Never label a local SSH-client CWD as the nested server's CWD.
- Bind live terminal location signals to PTY incarnation and foreground process identity.
- Test shell → SSH → shell transitions, including replay and stale-signal boundaries.
