// @vitest-environment happy-dom

import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTerminalManagerInlineRenameFocus } from './use-terminal-manager-inline-rename-focus'

async function flushAnimationFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await act(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
    )
  }
}

function RenameHarness({ onCommit }: { onCommit: (value: string) => void }): React.JSX.Element {
  const [active, setActive] = useState(false)
  const [value, setValue] = useState('Session')
  const resolvedRef = useRef(false)
  const commit = (): void => {
    if (resolvedRef.current) {
      return
    }
    resolvedRef.current = true
    onCommit(value)
    setActive(false)
  }
  const renameFocus = useTerminalManagerInlineRenameFocus({
    active,
    isResolved: () => resolvedRef.current,
    onCommit: commit
  })

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          resolvedRef.current = false
          setActive(true)
        }}
      >
        Rename
      </button>
      {active ? (
        <input
          ref={renameFocus.inputRef}
          aria-label="Session name"
          data-tab-rename-input="true"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={renameFocus.onBlur}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            } else if (event.key === 'Escape') {
              resolvedRef.current = true
              setActive(false)
            }
          }}
        />
      ) : null}
      <button type="button">Outside</button>
      <textarea className="xterm-helper-textarea" aria-label="Terminal input" />
    </div>
  )
}

describe('useTerminalManagerInlineRenameFocus', () => {
  afterEach(cleanup)

  it('keeps the draft open when xterm steals focus without user intent', async () => {
    const onCommit = vi.fn()
    render(<RenameHarness onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await flushAnimationFrames()
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'Draft title' } })
    input.setSelectionRange(5, 5)

    act(() => screen.getByRole('textbox', { name: 'Terminal input' }).focus())
    await flushAnimationFrames(1)

    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Draft title')
    expect(input.selectionStart).toBe(5)
    expect(input.selectionEnd).toBe(5)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('honors an outside pointer before the initial focus frame runs', () => {
    const onCommit = vi.fn()
    render(<RenameHarness onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const outside = screen.getByRole('button', { name: 'Outside' })

    fireEvent.pointerDown(outside)

    expect(onCommit).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull()
  })

  it('commits after an intentional outside pointer blur', async () => {
    const onCommit = vi.fn()
    render(<RenameHarness onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await flushAnimationFrames()
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' })
    fireEvent.change(input, { target: { value: 'Renamed session' } })
    const outside = screen.getByRole('button', { name: 'Outside' })

    fireEvent.pointerDown(outside)
    act(() => outside.focus())

    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenCalledWith('Renamed session')
    expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull()
  })

  it('commits when Tab intentionally moves focus away', async () => {
    const onCommit = vi.fn()
    render(<RenameHarness onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await flushAnimationFrames()
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' })
    const outside = screen.getByRole('button', { name: 'Outside' })

    fireEvent.keyDown(input, { key: 'Tab' })
    act(() => outside.focus())

    expect(onCommit).toHaveBeenCalledOnce()
  })

  it('commits when focus crosses into an Electron webview guest', async () => {
    const onCommit = vi.fn()
    render(<RenameHarness onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await flushAnimationFrames()
    const webview = document.createElement('webview')
    document.body.append(webview)

    fireEvent.focusIn(webview)

    expect(onCommit).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull()
    webview.remove()
  })

  it('invalidates delayed refocus work after Escape closes the editor', async () => {
    const onCommit = vi.fn()
    render(<RenameHarness onCommit={onCommit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await flushAnimationFrames()
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' })
    const terminalInput = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Terminal input'
    })
    act(() => terminalInput.focus())
    fireEvent.keyDown(input, { key: 'Escape' })

    await flushAnimationFrames(1)

    expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
  })
})
