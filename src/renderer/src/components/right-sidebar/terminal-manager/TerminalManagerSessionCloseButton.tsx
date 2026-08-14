import { X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'

export function TerminalManagerSessionCloseButton({
  displayTitle,
  onClose
}: {
  displayTitle: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="mr-0.5 size-6 shrink-0 opacity-0 hover:bg-accent group-hover/session:opacity-100 focus-visible:opacity-100"
      aria-label={translate('terminalManager.close', 'Close {{value0}}', {
        value0: displayTitle
      })}
      onClick={onClose}
    >
      <X className="size-3.5" />
    </Button>
  )
}
