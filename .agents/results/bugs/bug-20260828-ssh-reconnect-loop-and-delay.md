# Bug: SSH Relay Reconnect Loops or Stalls After a Disconnect

**Date Reported**: 2026-08-28
**Date Fixed**: 2026-08-28
**Reporter**: User
**Assignee**: Codex
**Severity**: HIGH
**Status**: FIXED

## Problem Description

After an established SSH terminal lost its connection, Orca could remain on the
`SSH connection required` / `Connecting...` overlay for a long time. Some reconnects eventually
succeeded, while others repeatedly attached and dropped before becoming usable.

## Reproduction and Evidence

The affected remote relay log provided direct production evidence. After a transport loss, it
accepted replacement clients and then immediately closed them with
`Relay control publication capacity exceeded`. The log recorded ten such capacity closes between
2026-08-27 15:03:49 UTC and 15:09:31 UTC before the thirteenth accepted client remained connected.
The relay retained 23 PTYs during this sequence, so reconnect had a substantial burst of recovery
work.

Two test-first reproductions isolated the failure modes:

- Three concurrent `pty.attach` responses carrying 400 KiB of scrollback exceeded the aggregate
  one-MiB control queue. Before the fix, the regression expected the client to remain open but
  observed one forced close.
- Overlapping relay reconnects created an `AbortController`, but the deployment call did not receive
  its signal. The stale deployment therefore remained alive after its replacement started.

Code inspection also showed that every reconnect repeated platform detection, remote-home lookup,
install-state checks, Node resolution, native dependency checks, and socket probing even when the
same process had just used a known relay endpoint.

## Root Cause

Four behaviors compounded into the visible stall:

1. Concurrent PTY recovery responses all used the bounded control lane. Several individually valid
   scrollback responses could exceed its aggregate byte limit and close the new relay client.
2. Bursty `pty.deliveryCanceled` recovery proofs also used only the fatal control lane. Once that
   lane filled, recovery closed the socket and recreated the same burst on the next attempt.
3. `SshRelaySession` canceled superseded reconnect controllers without passing their signals into
   `deployAndLaunchRelay`, so obsolete SSH channel and bootstrap work continued in parallel.
4. A warm reconnect had no process-local fast path to the already authenticated relay endpoint and
   paid the full bootstrap probe sequence again.

## Solution

- Spill response frames to the existing bounded producer reserve whenever the control lane lacks
  room. This preserves protocol responses without weakening the normal fatal control-overflow rule.
- Allow durable recovery controls to opt into the same bounded spill behavior, and use it for
  `pty.deliveryCanceled`. If both bounded reserves are exhausted, the existing close behavior still
  protects relay memory.
- Thread the session attempt's abort signal through relay deployment and every nested SSH operation.
  Superseded or disposed attempts now stop instead of competing with the current reconnect.
- Remember only complete relay endpoint metadata after a successful deployment. A reconnect to the
  same SSH target now attaches directly to that endpoint before running bootstrap probes.
- Validate the SSH target identity before reusing a remembered endpoint. A changed host skips the
  hint, while a stale endpoint is evicted and falls back to the full safe bootstrap path.
- Update the owner-lease IPC regression to fail provider registration explicitly; its former
  request-order assumption had drifted after the redundant warm-connect RPC was removed.

## Verification

- Test-first capacity regression failed before the dispatcher fix (`expected 0 closes, received 1`)
  and passed afterward.
- `nvm exec 24 pnpm exec vitest run src/main/ssh/ssh-relay*.test.ts`: 29 files passed,
  2 skipped; 367 tests passed, 4 skipped.
- `nvm exec 24 pnpm exec vitest run src/relay/*.test.ts`: 117 files and 1,388 tests passed.
- `nvm exec 24 pnpm exec vitest run src/main/ipc/ssh.test.ts src/main/ssh/ssh-connection.test.ts src/main/ssh/ssh-connection-manager.test.ts src/main/providers/ssh-pty-provider.test.ts`:
  4 files and 250 tests passed.
- `nvm exec 24 pnpm run typecheck:node`: passed under Node 24.19.0.
- `nvm exec 24 pnpm run check:code-quality:changed`: native, type-aware, and React checks
  reported zero new findings.
- `nvm exec 24 pnpm run check:reliability-gates`: all 81 manifest gates passed.
- `nvm exec 24 pnpm run check:max-lines-ratchet`: passed with no new bypasses.
- `git diff --check`: passed.

## Residual Risk

- A genuinely unreachable SSH host retains the existing initial-connect policy: five 30-second
  attempts with two-second gaps can still take up to 158 seconds. This change targets recovery after
  a previously successful connection and does not shorten host-availability tolerances.
- Remembered endpoints are process-local. The first connection after an Orca restart still performs
  the normal compatibility and install checks.
- A stale remembered endpoint safely falls back to full bootstrap, but its failed direct channel
  attempt can still consume the bounded SSH channel-open/sentinel timeout first.
- Durable recovery spill remains bounded. Exhausting both control and producer reserves still closes
  the client rather than allowing unbounded memory growth.

## Prevention

- Test aggregate reconnect bursts, not only whether each individual response fits a frame limit.
- Keep recovery-critical publications durable without making ordinary producer floods fatal.
- Propagate attempt cancellation through every remote operation and assert the signal in overlap
  tests.
- Cache only non-secret, complete endpoint metadata and bind reuse to stable target identity.
- Preserve safe fallback behavior for stale endpoints and changed targets.
