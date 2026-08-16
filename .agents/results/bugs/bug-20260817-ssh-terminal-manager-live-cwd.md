# Bug: SSH Terminal Manager Shows the Launch Folder Instead of the Live Working Folder

**Date Reported**: 2026-08-17
**Date Fixed**: 2026-08-17
**Reporter**: User
**Assignee**: Codex
**Severity**: HIGH
**Status**: FIXED

## Problem Description

The Terminal Manager correctly displayed the SSH server, but its second line remained at the
session's launch directory (for example, `/root`) after the active shell or foreground agent moved
to another directory such as `/home/test`.

Expected behavior is for a visible direct-SSH session to update the displayed directory while the
session runs, without requiring the user to recreate or reactivate the terminal.

## Reproduction Steps

1. Open a direct-SSH terminal whose launch directory is `/root`.
2. Change to `/home/test`, or run a foreground command/agent whose process-group leader works from
   `/home/test` while the waiting parent shell remains in `/root`.
3. Open Terminal Manager.
4. Observe `server · /root` instead of `server · /home/test`.

**Frequency**: consistent when a confirmed startup OSC 7 value existed; also reproducible while a
foreground command used a different CWD from its waiting shell.

## Evidence

- A renderer regression reproduced a confirmed `/srv/old` OSC value masking a provider result of
  `/srv/new` for the same direct-SSH PTY.
- A real Linux `node-pty` regression kept the interactive shell in its initial directory, launched a
  foreground process-group leader from another directory, and verified the old root-PID lookup still
  returned the initial directory.
- The relay route from `window.api.pty.getCwd()` through `SshPtyProvider` to `pty.getCwd` was intact;
  the stale selection happened at the live-CWD source and renderer precedence boundaries.

User reference screenshot: `/home/imageshare/uploads/hwxllFRP.png`.

## Root Cause

Two independent assumptions made the launch directory look authoritative:

1. Once the renderer had a confirmed OSC 7 entry, it stopped polling `pty.getCwd` and always
   preferred that entry. Direct SSH sessions can retain an older OSC value while the foreground
   agent changes directory without emitting a new prompt.
2. The relay queried only the outer `node-pty` shell PID. During job control that shell waits in its
   own directory while the terminal foreground process group performs the active work elsewhere.

Returning `initialCwd` when live inspection failed compounded the issue by making an unknown result
indistinguishable from a verified current directory.

## Solution

- Keep visible direct-SSH sessions eligible for live CWD polling even when an OSC 7 entry is
  confirmed.
- Poll the active direct-SSH row every two seconds, respecting the existing visibility and global
  concurrency limits.
- Prefer a non-empty provider result for the same direct-SSH PTY over an older pane OSC value.
- Discard the last provider result after an empty/error response so it cannot mask a newer OSC
  value during reconnect or on a platform where live inspection is unavailable.
- On Linux, read the PTY root process's `/proc/<pid>/stat`, resolve its terminal foreground process
  group leader (`tpgid`), and use that leader's CWD.
- Validate root start time, PTY slave, session, tty, process group, and pre/post process identity so
  exited or reused PIDs cannot supply a stale directory.
- Avoid whole-process-table scans and shell-profile injection; the lookup uses bounded `/proc`
  reads and returns an empty string when no live value can be proven.
- Preserve the launch directory only as the existing UI fallback, not as a successful live lookup.

No data or configuration migration is required.

## Verification

- Pure relay tests cover stat parsing, foreground-group selection, tty/session mismatch, PID reuse,
  foreground transitions, captured PTY identity, and unsupported-platform fallback behavior.
- A real Linux `node-pty` test covers a waiting shell in one directory and a foreground command in
  another.
- Renderer tests cover a confirmed non-launch OSC value being replaced by a newer direct-SSH
  provider value and the active two-second refresh cadence.
- The SSH provider and relay handler boundary suites remain green.
- Node and web type checks, scoped lint, formatting, and diff checks pass.
- The Windows portable workflow explicitly runs the pure relay and both renderer CWD suites under
  Node 24 before building artifacts.

## Prevention

- Treat OSC 7 and provider CWD as independently stale signals and bind both to the exact PTY ID.
- Do not use a launch directory as evidence that a live process lookup succeeded.
- Derive terminal foreground work from the kernel's job-control identity rather than arbitrary
  descendants or full process-table heuristics.
- Keep a real PTY integration test alongside pure race and identity tests.
