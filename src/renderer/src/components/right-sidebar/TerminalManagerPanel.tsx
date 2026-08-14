import { SquareTerminal } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { TerminalManagerWorkspace } from './terminal-manager/TerminalManagerWorkspace'

export default function TerminalManagerPanel(): React.JSX.Element {
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)

  if (!activeWorktreeId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <SquareTerminal className="size-7 opacity-50" aria-hidden="true" />
        <p className="text-xs">
          {translate(
            'terminalManager.noProject',
            'Open a project to manage its terminal sessions.'
          )}
        </p>
      </div>
    )
  }

  return <TerminalManagerWorkspace key={activeWorktreeId} worktreeId={activeWorktreeId} />
}
