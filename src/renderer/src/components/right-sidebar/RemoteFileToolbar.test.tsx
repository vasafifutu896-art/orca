// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RemoteFileToolbar, type RemoteFileToolbarProps } from './RemoteFileToolbar'

afterEach(cleanup)

function makeProps(overrides: Partial<RemoteFileToolbarProps> = {}): RemoteFileToolbarProps {
  return {
    pathValue: '/home/dev/project',
    onPathValueChange: vi.fn(),
    onNavigatePath: vi.fn(),
    onNavigateUp: vi.fn(),
    onNavigateHome: vi.fn(),
    onRefresh: vi.fn(),
    onUploadFiles: vi.fn(),
    onUploadFolder: vi.fn(),
    onDownloadSelected: vi.fn(),
    canDownloadSelected: true,
    ...overrides
  }
}

function renderToolbar(props: RemoteFileToolbarProps): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <RemoteFileToolbar {...props} />
    </TooltipProvider>
  )
}

describe('RemoteFileToolbar', () => {
  it('exposes dense navigation and transfer actions with accessible labels', () => {
    renderToolbar(makeProps())

    expect(screen.getByRole('navigation', { name: 'Remote file controls' })).toHaveAttribute(
      'data-ignore-file-explorer-keys',
      'true'
    )
    expect(screen.getByRole('group', { name: 'Remote file actions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Parent folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Home folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload files' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download selected' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Remote path' })).toHaveValue('/home/dev/project')
  })

  it('routes navigation and transfer actions to typed callbacks', async () => {
    const user = userEvent.setup()
    const props = makeProps()
    renderToolbar(props)

    await user.click(screen.getByRole('button', { name: 'Parent folder' }))
    await user.click(screen.getByRole('button', { name: 'Home folder' }))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await user.click(screen.getByRole('button', { name: 'Upload files' }))
    await user.click(screen.getByRole('button', { name: 'Upload folder' }))
    await user.click(screen.getByRole('button', { name: 'Download selected' }))

    expect(props.onNavigateUp).toHaveBeenCalledOnce()
    expect(props.onNavigateHome).toHaveBeenCalledOnce()
    expect(props.onRefresh).toHaveBeenCalledOnce()
    expect(props.onUploadFiles).toHaveBeenCalledOnce()
    expect(props.onUploadFolder).toHaveBeenCalledOnce()
    expect(props.onDownloadSelected).toHaveBeenCalledOnce()
  })

  it('edits the controlled path and trims it before Enter navigation', async () => {
    const user = userEvent.setup()
    const props = makeProps({ pathValue: '  /srv/apps  ' })
    renderToolbar(props)

    const input = screen.getByRole('textbox', { name: 'Remote path' })
    fireEvent.change(input, { target: { value: '/srv/releases' } })
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(props.onPathValueChange).toHaveBeenCalledWith('/srv/releases')
    expect(props.onNavigatePath).toHaveBeenCalledWith('/srv/apps')
  })

  it('keeps unavailable actions tooltip-reachable and blocks their callbacks', async () => {
    const props = makeProps({
      canNavigateUp: false,
      canUploadFiles: false,
      canUploadFolder: false,
      canDownloadSelected: false
    })
    renderToolbar(props)

    const uploadFiles = screen.getByRole('button', { name: 'Upload files' })
    expect(uploadFiles).toHaveAttribute('aria-disabled', 'true')
    expect(uploadFiles).not.toBeDisabled()
    fireEvent.focus(uploadFiles)
    expect(await screen.findAllByText('Upload files')).not.toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Parent folder' }))
    fireEvent.click(uploadFiles)
    fireEvent.click(screen.getByRole('button', { name: 'Upload folder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download selected' }))

    expect(props.onNavigateUp).not.toHaveBeenCalled()
    expect(props.onUploadFiles).not.toHaveBeenCalled()
    expect(props.onUploadFolder).not.toHaveBeenCalled()
    expect(props.onDownloadSelected).not.toHaveBeenCalled()
  })

  it('locks transfer actions and marks the active operation while uploading', () => {
    renderToolbar(makeProps({ busyAction: 'upload-files' }))

    expect(screen.getByRole('navigation', { name: 'Remote file controls' })).toHaveAttribute(
      'aria-busy',
      'true'
    )
    expect(screen.getByRole('status')).toHaveTextContent('Remote file operation in progress')
    expect(screen.getByRole('button', { name: 'Upload files' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Upload folder' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Download selected' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-disabled', 'true')
  })
})
