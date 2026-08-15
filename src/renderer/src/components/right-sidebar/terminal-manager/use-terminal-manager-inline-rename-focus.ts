import { useCallback, useEffect, useRef } from 'react'

type Options = {
  active: boolean
  isResolved: () => boolean
  onCommit: () => void
}

type Result = {
  inputRef: React.RefObject<HTMLInputElement | null>
  onBlur: () => void
}

/**
 * Keeps terminal-manager rename inputs alive across delayed Radix/xterm focus handoffs.
 * Only an explicit outside pointer or Tab navigation is allowed to commit on blur.
 */
export function useTerminalManagerInlineRenameFocus({
  active,
  isResolved,
  onCommit
}: Options): Result {
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef(active)
  const isResolvedRef = useRef(isResolved)
  const onCommitRef = useRef(onCommit)
  const sessionIdRef = useRef(0)
  const userRequestedBlurCommitRef = useRef(false)
  const focusFrameRef = useRef<number | null>(null)
  const refocusFrameRef = useRef<number | null>(null)

  activeRef.current = active
  isResolvedRef.current = isResolved
  onCommitRef.current = onCommit

  const cancelPendingFrames = useCallback((): void => {
    for (const frameRef of [focusFrameRef, refocusFrameRef]) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [])

  const closeSession = useCallback((): void => {
    sessionIdRef.current += 1
    userRequestedBlurCommitRef.current = false
    cancelPendingFrames()
  }, [cancelPendingFrames])

  useEffect(() => {
    if (!active) {
      return
    }
    cancelPendingFrames()
    sessionIdRef.current += 1
    userRequestedBlurCommitRef.current = false
    const sessionId = sessionIdRef.current

    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (!activeRef.current || sessionIdRef.current !== sessionId) {
        return
      }
      const input = inputRef.current
      if (!input) {
        return
      }
      input.focus()
      input.select()
    })

    return closeSession
  }, [active, cancelPendingFrames, closeSession])

  useEffect(() => {
    if (!active) {
      return
    }
    const markPointerBlurIntent = (event: PointerEvent): void => {
      const input = inputRef.current
      const target = event.target
      if (input && target instanceof Node && input.contains(target)) {
        return
      }
      userRequestedBlurCommitRef.current = true
      if (input && document.activeElement !== input && !isResolvedRef.current()) {
        onCommitRef.current()
      }
    }
    const markKeyboardBlurIntent = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        userRequestedBlurCommitRef.current = true
      }
    }
    const commitAfterWindowBlur = (): void => {
      userRequestedBlurCommitRef.current = true
      if (!isResolvedRef.current()) {
        onCommitRef.current()
      }
    }
    const commitAfterWebviewFocus = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLElement) || target.tagName !== 'WEBVIEW') {
        return
      }
      commitAfterWindowBlur()
    }

    document.addEventListener('pointerdown', markPointerBlurIntent, true)
    document.addEventListener('keydown', markKeyboardBlurIntent, true)
    document.addEventListener('focusin', commitAfterWebviewFocus, true)
    window.addEventListener('blur', commitAfterWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', markPointerBlurIntent, true)
      document.removeEventListener('keydown', markKeyboardBlurIntent, true)
      document.removeEventListener('focusin', commitAfterWebviewFocus, true)
      window.removeEventListener('blur', commitAfterWindowBlur)
    }
  }, [active])

  const onBlur = useCallback((): void => {
    if (isResolvedRef.current()) {
      return
    }
    if (userRequestedBlurCommitRef.current) {
      onCommitRef.current()
      return
    }
    if (!activeRef.current || refocusFrameRef.current !== null) {
      return
    }
    const sessionId = sessionIdRef.current
    refocusFrameRef.current = requestAnimationFrame(() => {
      refocusFrameRef.current = null
      if (!activeRef.current || sessionIdRef.current !== sessionId) {
        return
      }
      const input = inputRef.current
      if (!input) {
        return
      }
      input.focus()
    })
  }, [])

  return { inputRef, onBlur }
}
