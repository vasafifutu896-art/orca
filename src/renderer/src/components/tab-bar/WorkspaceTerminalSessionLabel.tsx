import { SquareTerminal } from 'lucide-react'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { useAppStore } from '../../store'

export function WorkspaceTerminalSessionLabel({ tab }: { tab: TerminalTab }): React.JSX.Element {
  const generatedTitlesEnabled = useAppStore(
    (state) => state.settings?.tabAutoGenerateTitle === true
  )
  const title = resolveTerminalTabTitle(tab, generatedTitlesEnabled, tab.defaultTitle ?? 'Terminal')

  return (
    <div
      className="flex h-full min-w-0 max-w-72 shrink items-center gap-1.5 px-2.5 text-xs text-foreground"
      data-terminal-session-location="true"
    >
      <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate font-medium">{title}</span>
    </div>
  )
}
