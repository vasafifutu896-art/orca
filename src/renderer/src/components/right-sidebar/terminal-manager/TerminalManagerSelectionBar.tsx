import { X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'

export function TerminalManagerSelectionBar({
  count,
  onClear
}: {
  count: number
  onClear: () => void
}): React.JSX.Element | null {
  if (count < 2) {
    return null
  }
  return (
    <div
      className="mx-2 mt-2 flex h-7 items-center rounded-md bg-accent/60 px-2 text-[11px] text-foreground"
      data-terminal-manager-selection-count={count}
      role="status"
    >
      <span className="min-w-0 flex-1 truncate">
        {translate('terminalManager.selectedCount', '{{value0}} sessions selected', {
          value0: count
        })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-5"
        aria-label={translate('terminalManager.clearSelection', 'Clear selection')}
        onClick={onClear}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}
