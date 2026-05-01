interface Conversation {
  id: string
  title: string
  createdAt: number
}

interface Props {
  conversations: Conversation[]
  activeId: string
  providerLabel: 'Local' | 'Pi AI'
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export default function Sidebar({
  conversations,
  activeId,
  providerLabel,
  onSelect,
  onNew,
  onDelete
}: Props) {
  return (
    <div className="drag flex h-full w-60 shrink-0 flex-col border-r border-sidebar-active/60 bg-sidebar text-white">
      <div className="h-11 shrink-0" />
      <div className="no-drag px-3 pb-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[13px] font-medium text-white transition hover:border-white/25 hover:bg-white/15"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          New chat
        </button>
      </div>
      <div className="no-drag min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {conversations.map((c) => (
          <div key={c.id} className="group relative">
            <button
              onClick={() => onSelect(c.id)}
              className={`w-full truncate rounded-lg px-3 py-2 text-left text-[13px] transition-all duration-200 ease-out ${
                activeId === c.id
                  ? 'bg-sidebar-active text-white'
                  : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              {c.title}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm('Delete this chat?')) onDelete(c.id)
              }}
              className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-md text-white/60 hover:bg-white/15 hover:text-white group-hover:flex"
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
                <path d="M4 4l8 8M12 4L4 12" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="no-drag border-t border-white/15 p-3 text-[11px] text-white/70">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
            {providerLabel === 'Local' ? 'Running locally' : 'Pi AI provider'}
          </div>
          <a
            href="https://x.com/ammaar"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/45 transition hover:text-white/80"
          >
            @ammaar
          </a>
        </div>
      </div>
    </div>
  )
}
