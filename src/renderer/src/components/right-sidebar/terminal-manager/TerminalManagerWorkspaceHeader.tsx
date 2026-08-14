import { useRef, useState } from 'react'
import { BellOff, BellRing, FolderPlus, Loader2, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Props = {
  completionNotificationsEnabled: boolean
  onAddGroup: (name: string) => void
  onCreateSession: () => Promise<void>
  onToggleCompletionNotifications: () => void
  projectName: string
}

export function TerminalManagerWorkspaceHeader({
  completionNotificationsEnabled,
  onAddGroup,
  onCreateSession,
  onToggleCompletionNotifications,
  projectName
}: Props): React.JSX.Element {
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [isAddingGroup, setIsAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const newGroupResolvedRef = useRef(false)

  const beginAddGroup = (): void => {
    newGroupResolvedRef.current = false
    setNewGroupName('')
    setIsAddingGroup(true)
  }
  const commitAddGroup = (): void => {
    if (newGroupResolvedRef.current) {
      return
    }
    newGroupResolvedRef.current = true
    const name = newGroupName.trim()
    if (name) {
      onAddGroup(name)
    }
    setIsAddingGroup(false)
  }
  const cancelAddGroup = (): void => {
    newGroupResolvedRef.current = true
    setIsAddingGroup(false)
  }
  const createSession = async (): Promise<void> => {
    if (isCreatingSession) {
      return
    }
    setIsCreatingSession(true)
    try {
      await onCreateSession()
    } finally {
      setIsCreatingSession(false)
    }
  }

  return (
    <div className="border-b border-border px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xs font-semibold text-foreground">
            {translate('terminalManager.title', 'Terminal manager')}
          </h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{projectName}</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate('terminalManager.newGroup', 'New group')}
              onClick={beginAddGroup}
            >
              <FolderPlus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {translate('terminalManager.newGroup', 'New group')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={translate('terminalManager.newSession', 'New terminal session')}
              disabled={isCreatingSession}
              onClick={() => void createSession()}
            >
              {isCreatingSession ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {translate('terminalManager.newSession', 'New terminal session')}
          </TooltipContent>
        </Tooltip>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="mt-1.5 h-6 justify-start px-1.5 text-[10px] font-normal text-muted-foreground"
        aria-pressed={completionNotificationsEnabled}
        onClick={onToggleCompletionNotifications}
      >
        {completionNotificationsEnabled ? (
          <BellRing className="size-3" />
        ) : (
          <BellOff className="size-3" />
        )}
        {completionNotificationsEnabled
          ? translate('terminalManager.completionNotificationsOn', 'AI completion alerts on')
          : translate('terminalManager.completionNotificationsOff', 'AI completion alerts off')}
      </Button>
      {isAddingGroup ? (
        <Input
          autoFocus
          value={newGroupName}
          aria-label={translate('terminalManager.groupName', 'Group name')}
          placeholder={translate('terminalManager.groupNamePlaceholder', 'e.g. Implementation')}
          className="mt-2 h-7 px-2 py-0 text-xs"
          maxLength={80}
          spellCheck={false}
          onChange={(event) => setNewGroupName(event.target.value)}
          onBlur={commitAddGroup}
          onKeyDown={(event) => {
            if (isImeCompositionKeyDown(event)) {
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              commitAddGroup()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelAddGroup()
            }
          }}
        />
      ) : null}
    </div>
  )
}
