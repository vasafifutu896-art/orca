# Handoff: Per-Task Windows Installer and Portable Delivery

**Date**: 2026-08-23
**Status**: IMPLEMENTED

## Objective

Every completed task that changes runnable Orca behavior must give the user permanent GitHub
Release download links for both a Windows installer and a portable executable built from the exact
final pushed commit.

## Prior Gap

The earlier completion rule stopped after committing and pushing source. The existing
`portable-windows.yml` workflow built only portable assets, retained them as temporary GitHub
Actions artifacts, and required a separate manual release upload. The fork had no branch delivery
path that produced an installer and portable executable together.

## Implementation

- The Windows workflow now builds `orca-windows-portable.exe`, then reuses its verified
  `win-unpacked` directory to build `orca-windows-setup.exe` without repeating the full application
  build.
- The installer is silently installed on the disposable Windows runner and checked for the
  installed `Orca.exe`.
- Installer, portable executable, folder-portable ZIP, benchmark output, and generated SHA-256 files
  remain available as one Actions artifact for recovery.
- A `task-build-<12-character-SHA>` annotated tag triggers an exact-commit handoff. The workflow
  validates the tag/commit relationship, creates a draft prerelease, uploads every asset, compares
  GitHub's asset digests with the local files, and publishes the release only after the complete set
  is verified.
- Root agent instructions now require permanent installer and portable release links in the final
  response. Older builds and expiring Actions links cannot substitute for the current task build.

## Required User Assets

- `orca-windows-setup.exe`
- `orca-windows-setup.exe.sha256`
- `orca-windows-portable.exe`
- `orca-windows-portable.exe.sha256`

The folder-portable ZIP and startup benchmark are supplemental evidence.

## Verification

- Parse the workflow and run `config/scripts/windows-delivery-workflow.test.mjs`.
- Run the repository's changed-code quality and max-lines gates.
- Push the final branch commit, create its deterministic task-build tag, and wait for the tagged
  Windows workflow to succeed.
- Confirm the GitHub tag resolves to the final commit, the prerelease is non-draft, every required
  asset is non-empty, and both direct download URLs resolve.

## Signing and Compatibility

The fork's task handoff builds are unsigned because production SignPath credentials and approval are
available only to the canonical release pipeline. The prerelease notes and final response must say
that Windows SmartScreen may warn. Do not claim SignPath signing unless the official signing gates
actually passed.

The workflow runs on `windows-2022`; Orca's Windows native launcher and foreground-permission addon
cannot be packaged correctly from the Linux development host.

## Future Work

If signed task builds become necessary, add a separately authorized SignPath preview policy rather
than reusing or weakening the production `release-cut` workflow.
