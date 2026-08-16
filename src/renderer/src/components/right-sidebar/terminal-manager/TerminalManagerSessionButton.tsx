import type { MouseEventHandler } from 'react'
import { Pin } from 'lucide-react'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TerminalTabLeadingIcon } from '../../tab-bar/TerminalTabLeadingIcon'
import type { TerminalTabActivityStatus } from '../../tab-bar/terminal-tab-activity-status'
import {
  formatFullTerminalManagerSessionLocation,
  formatTerminalManagerSessionLocation,
  type TerminalManagerSessionLocation
} from './terminal-manager-session-location'

type Props = {
  activityStatus: TerminalTabActivityStatus
  displayTitle: string
  isActive: boolean
  isPinned: boolean
  isSelected: boolean
  onAuxClick: MouseEventHandler<HTMLButtonElement>
  onClick: MouseEventHandler<HTMLButtonElement>
  onDoubleClick: MouseEventHandler<HTMLButtonElement>
  showUnreadActivity: boolean
  tab: TerminalTab
  tabAgent: TuiAgent | null
  location: TerminalManagerSessionLocation
}

export function TerminalManagerSessionButton({
  activityStatus,
  displayTitle,
  isActive,
  isPinned,
  isSelected,
  onAuxClick,
  onClick,
  onDoubleClick,
  showUnreadActivity,
  tab,
  tabAgent,
  location
}: Props): React.JSX.Element {
  const compactLocation = formatTerminalManagerSessionLocation(location)
  const fullLocation = formatFullTerminalManagerSessionLocation(location)
  const locationDescriptionId = `terminal-manager-session-location-${tab.id}`
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto min-h-10 min-w-0 flex-1 items-start justify-start gap-0 rounded-md px-1.5 py-1 text-xs font-normal hover:bg-transparent"
      aria-current={isActive ? 'page' : undefined}
      aria-pressed={isSelected}
      aria-label={displayTitle}
      aria-describedby={locationDescriptionId}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onAuxClick={onAuxClick}
    >
      <span className="flex h-4 shrink-0 items-center">
        <TerminalTabLeadingIcon
          agent={tabAgent}
          activityStatus={activityStatus}
          shell={tab.shellOverride}
          showUnreadActivity={showUnreadActivity}
          isActive={isActive}
        />
        {isPinned ? <Pin className="mr-1 size-3 shrink-0 text-muted-foreground" /> : null}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate leading-4">{displayTitle}</span>
        <span
          className="block truncate font-mono text-[11px] leading-4 text-foreground/70"
          data-terminal-manager-session-cwd="true"
          data-terminal-manager-session-location="true"
        >
          {compactLocation}
        </span>
        <span id={locationDescriptionId} className="sr-only">
          {fullLocation}
        </span>
      </span>
      {tab.color ? (
        <span
          className="ml-1 mt-1 size-2 shrink-0 rounded-full"
          style={{ backgroundColor: tab.color }}
          aria-hidden="true"
        />
      ) : null}
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-sm break-all font-mono text-xs">
        {fullLocation}
      </TooltipContent>
    </Tooltip>
  )
}
