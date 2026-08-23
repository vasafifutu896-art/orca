# Bug: SSH Ready State Waits on Avoidable Serial Relay Work

**Date Reported**: 2026-08-23
**Date Fixed**: 2026-08-23
**Reporter**: User
**Assignee**: Codex
**Severity**: HIGH
**Status**: FIXED

## Problem Description

An SSH transport can already be connected while Orca continues to show the connection as pending.
The delay is most visible on a warm remote with non-trivial network latency because Orca does not
publish the SSH providers until relay initialization and every provider prerequisite have finished.

## Reproduction and Evidence

1. Connect Orca to an SSH target with saved remote repositories and remote agent hooks enabled.
2. Repeat the connection over a higher-latency link after the relay has already been installed.
3. Observe that readiness waits for remote root discovery, plugin synchronization, and remote CLI
   installation in sequence.

The previous setup path also sent `session.resolveHome("~")` after PTY consumer admission and
discarded its result. PTY consumer admission already requires a relay RPC response, including the
legacy method-not-found fallback, so this was a duplicate liveness round trip.

A Docker sshd diagnostic measured the existing relay path at about 0.93 seconds when warm and local.
With roughly 200 ms round-trip latency, the same warm path took about 8.98 seconds before the
provider-registration work measured by the UI was included. This confirms that serial WAN round
trips, rather than SSH encryption itself, dominate the warm path.

The regression tests were added before the implementation change. They failed because the setup
still issued `session.resolveHome` on establish and reconnect, and because plugin/CLI preparation
did not start while root discovery was pending.

## Root Cause

`SshRelaySession` treated four independent readiness checks as one serial pipeline:

1. PTY consumer admission
2. A redundant home-resolution health request
3. Remote root/worktree discovery
4. Plugin synchronization followed by remote CLI launcher installation

Each remote request added another full network round trip. Initial connect and reconnect shared the
same unnecessary sequence.

## Solution

- Use the required PTY consumer admission response as the relay liveness proof and remove the
  discarded home-resolution request from both establish and reconnect.
- Run remote root discovery, plugin synchronization, and remote CLI launcher installation
  concurrently.
- Keep provider publication behind a single completion barrier so `ready` retains its prior meaning.
- Fence remote CLI directory creation, direct writes, SFTP writes, and post-write commands with the
  current connection attempt so an obsolete reconnect stops doing remote work.
- Update the stale-reconnect regression to delay the real PTY consumer handshake instead of the
  removed home-resolution probe.

This removes one WAN round trip and changes the independent preparation cost from the sum of all
three branches to the duration of the slowest branch.

## Verification

- SSH relay-session suite: 12 files, 126 tests passed.
- Dedicated test-first regression covers redundant RPC removal, concurrent preparation, readiness
  barrier preservation, and stale reconnect fencing.
- Node TypeScript check passed.
- Changed-code native, type-aware, and React quality gates reported zero new findings.
- Max-lines ratchet passed with no new bypasses.
- Nested SSH Terminal Manager core suite remained green: 8 files, 95 tests passed.

## Residual Risk

Cold connections still need to install the relay and native dependencies. Unreachable targets also
retain the existing retry policy: five 30-second attempts with two-second gaps can take up to 158
seconds for a black-holed address. Those policies are intentionally unchanged because shortening
them would trade away recovery on slow or temporarily unavailable hosts.

## Prevention

- Treat every relay RPC in the connection-ready path as a latency cost, especially over WAN links.
- Reuse mandatory protocol handshakes as liveness evidence instead of adding probe-only requests.
- Parallelize independent remote preparation while preserving one explicit publication barrier.
- Keep cancellation fencing at every remote side-effect boundary.
- Maintain race tests against the actual protocol step used by production.
