# Bug: SSH File Explorer Upload Is Hidden and Fails During Initial Load

**Date Reported**: 2026-08-15
**Date Fixed**: 2026-08-15
**Reporter**: User
**Assignee**: Codex
**Severity**: HIGH
**Status**: FIXED

## Problem Description

The SSH file explorer exposed upload only through OS drag-and-drop. It had no visible upload action,
and dropping a file immediately after opening SSH Home or while refreshing could fail. Switching
servers while the native drop was being relayed could also route the gesture against the wrong
current workspace unless ownership was captured with the drop.

Expected behavior is a conventional remote file manager: visible path navigation, file/folder
upload buttons, selected-item download, and reliable drag-and-drop upload.

Impact: every direct-SSH folder-workspace user had poor feature discoverability; upload failures
were timing-dependent, and the explorer did not behave like a conventional remote file manager.

## Reproduction Steps

1. Double-click a saved SSH server to open its Home workspace.
2. Before the initial file listing finishes, drag a local file onto the explorer.
3. Observe that no file appears remotely and the upload can terminate with an unresolved-owner error.
4. Observe that there is no visible file/folder upload button.

**Frequency**: specific conditions only — initial load or refresh while the root cache is loading.

## Evidence

The transport and SSH uploader suites passed, but there was no renderer hook test spanning the
native drop event and operation-owner capture. The failing seam was reproduced with an SSH folder
workspace whose root cache had no `operationOwner`.

User reference screenshot: `/home/imageshare/uploads/jmJktagU.png`.

## Root Cause

`FileExplorer` passed only `rootCache?.operationOwner` into `useFileExplorerImport`. During the
initial read that value does not exist yet, and `useFileExplorerTree.loadDir()` also replaced a
cached owner with a loading record that omitted it during refresh. The file-drop surface remained
active, so the event arrived, but `captureFileExplorerOperationGuard()` rejected the undefined
expected owner before transfer.

The UI separately had no explicit picker action; upload was discoverable only by knowing the
drag-and-drop gesture. The explorer also conflated the workspace Home with the visible remote
directory, which made server-wide navigation, mutations, and drop destinations inconsistent.

Finally, the preload relay originally carried only local paths and a destination. It did not bind
the gesture to the workspace root and complete operation-generation snapshot, leaving a race when
the active server, SSH generation, or paired runtime changed before the renderer handled the event.

Code locations:

- `src/renderer/src/components/right-sidebar/useFileExplorerImport.ts`
- `src/renderer/src/components/right-sidebar/useFileExplorerTree.ts`
- `src/renderer/src/components/right-sidebar/FileExplorer.tsx`

## Solution

- Preserve the cached operation owner while a directory refresh is loading.
- Fall back to the live workspace owner before capturing the SSH generation guard.
- Reuse one guarded import pipeline for drag-and-drop, multi-file picker uploads, and folder picker
  uploads.
- Capture ownership before opening the picker and reject a destination if the workspace changes.
- Bind native drops to the workspace ID, workspace root, and complete runtime/SSH generation
  snapshot before the event crosses the preload/main boundary.
- Add a Moba-style remote toolbar with Up, Home, Refresh, Upload files, Upload folder, Download
  selected, and an editable remote path.
- Resolve SSH ownership from the active folder workspace, not only from repository metadata.
- Render direct-SSH folders as a flat current-directory view; double-click/Enter/Space navigate,
  while F2 renames.
- Keep the operation workspace root separate from the currently viewed directory so create,
  rename, drag/drop, filtering, and refresh target the correct remote path.
- Parent native pickers to the Orca window that opened them, report partial/skipped uploads, and
  give explicit feedback for reconnects and concurrent drops.

No database or configuration migration is required. The change is additive to the preload API.

When browsing outside the configured SSH Home, external changes made by another process require the
visible Refresh action. Orca intentionally does not install a recursive watcher on arbitrary server
roots such as `/`, which could be prohibitively expensive.

## Verification

- Regression test covers native SSH Home drop with a missing cached owner.
- Picker tests cover multi-file and folder uploads through the guarded SSH route.
- Navigation tests cover Home, parent, typed absolute paths, SSH reconnects, and workspace changes.
- Drop tests cover cross-workspace, root-path, SSH-generation, runtime re-pairing, and concurrent
  upload races.
- Explorer tests cover current-directory filtering, remote keyboard/double-click navigation,
  workspace/view-root separation, and Home-external action guards.
- Main picker tests cover multi-selection and cancellation.
- Portable release-boundary result: 523 passed, 5 Windows-only skips across 32 suites under Node 24.
- Full node/CLI/web type checks, changed-code quality, React Doctor, localization catalog,
  extraction/coverage, formatting, max-lines ratchet, and diff checks pass.

## Prevention

- Treat cached provenance as an optimization, not the sole source of operation ownership.
- Preserve owner metadata across loading-state cache writes.
- Test UI event-to-owner seams in addition to transport and backend units.
- Keep core transfer features visible rather than gesture-only.
