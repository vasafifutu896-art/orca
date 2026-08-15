# Terminal Manager session rename closed before typing

## Report

Opening **Rename session** from the Terminal Manager could briefly show the editor and then close it before the user could type. The issue was most visible after activating a different terminal or closing the session context menu.

## Root cause

`TerminalManagerSessionRow` treated every input `blur` as an intentional save. Terminal activation and Radix menu teardown both schedule delayed focus restoration, so either could move focus to xterm after the rename input mounted. That programmatic focus handoff triggered `blur`, committed the unchanged title, and unmounted the editor.

## Fix

- Mark Terminal Manager rename inputs with the existing `data-tab-rename-input` focus guard.
- Share an inline-rename focus controller between session and group editors.
- Commit blur only after an explicit outside pointer action or Tab navigation.
- Refocus and retain the draft after an unsolicited xterm/Radix focus handoff.
- Invalidate pending animation-frame callbacks when editing ends.

## Regression coverage

- Hook tests cover unsolicited xterm focus, outside-pointer commit, Tab commit, and Escape cleanup.
- The Electron Terminal Manager test forces xterm focus while a session draft is open and verifies that the draft remains editable before explicit submission.
