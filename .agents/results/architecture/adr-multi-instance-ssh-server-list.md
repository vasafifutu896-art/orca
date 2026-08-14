# ADR: Multi-instance Orca and sidebar SSH sessions

## Context

Orca currently protects one `userData` profile with Electron's single-instance lock. The profile
owns runtime discovery files, daemon metadata, terminal sessions, and persisted UI state. The
requested workflow also needs registered SSH hosts in the left sidebar and a MobaXterm-style
double-click that opens a usable remote shell.

## Decision

Packaged desktop launches claim the lowest free persistent instance slot. Slot 1 keeps the existing
profile path; later slots use isolated profile directories beneath the primary profile. Every slot
retains its own Electron single-instance lock and runtime metadata. New slot profiles copy only
non-session settings and SSH target definitions from slot 1 on first creation.

The packaged native menu can launch a new detached Orca process without carrying the current slot
argument, providing a reliable explicit multi-window path on every desktop platform.

The sidebar renders the existing SSH target registry. Double-clicking a target connects through
Orca's existing SSH relay, resolves the remote home directory, reuses or creates a host-owned folder
workspace, activates it, and opens a new terminal tab on subsequent double-clicks.

## Alternatives Considered

1. Disable the single-instance lock while sharing one profile. Rejected because concurrent mains
   overwrite runtime discovery, hook endpoints, persistence, and daemon ownership metadata.
2. Add multiple `BrowserWindow` instances to one main process. Rejected for this change because the
   main process and many IPC publishers currently hold one global `mainWindow`; converting every
   owner to a window registry would be substantially broader and risk cross-window PTY delivery.
3. Launch the system `ssh` binary in a local terminal. Rejected because it bypasses Orca's existing
   credentials, relay lifecycle, remote PTY persistence, and workspace ownership model.

## Consequences

- Concurrent instances cannot corrupt one another's profile or runtime metadata.
- Secondary instances have stable, reusable profiles, but their project/session state intentionally
  diverges after creation.
- SSH targets present when a secondary profile is first created are seeded into it; later edits are
  profile-local.
- A stale slot lock left by a crash is reclaimed after its PID is no longer alive.
- The existing single-instance lock remains active inside each slot, preserving relaunch and
  duplicate-slot focus behavior.

## Validation

- Completed: unit tests for slot selection, stale-lock recovery, profile seeding, release ownership,
  and first/repeated SSH session opening.
- Completed: full typecheck, focused Vitest suites, localization checks, production renderer/main
  build, and an Electron E2E check of the sidebar and add-server flow.
- Release smoke test: launch a packaged build three times and open the same real SSH target from two
  slots; each should receive an independent terminal session.
