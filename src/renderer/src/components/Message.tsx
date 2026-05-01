import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import type { AgentActivity, ChatMessage, ToolCall } from '@shared/types'
import vibeLogoUrl from '../assets/vibe-logo.png'

interface Props {
  message: ChatMessage
  isLast: boolean
  streaming: boolean
  onRegenerate?: () => void
}

interface Parsed {
  thinking: string
  thinkingInProgress: boolean
  visible: string
}

function parseThinking(content: string): Parsed {
  const openRe = /<think(?:ing)?>/
  const closeRe = /<\/think(?:ing)?>/
  const openMatch = content.match(openRe)
  if (!openMatch) return { thinking: '', thinkingInProgress: false, visible: content }
  const before = content.slice(0, openMatch.index!)
  const after = content.slice(openMatch.index! + openMatch[0].length)
  const closeMatch = after.match(closeRe)
  if (!closeMatch) {
    return { thinking: after, thinkingInProgress: true, visible: before }
  }
  const thinking = after.slice(0, closeMatch.index!)
  const rest = after.slice(closeMatch.index! + closeMatch[0].length)
  return { thinking, thinkingInProgress: false, visible: (before + rest).trim() }
}

export default function Message({
  message,
  streaming,
  onRegenerate
}: Props) {
  const isUser = message.role === 'user'
  const parsed = useMemo(() => parseThinking(message.content), [message.content])
  const html = useMemo(() => {
    if (!parsed.visible) return ''
    try {
      return marked.parse(parsed.visible, { async: false, breaks: true }) as string
    } catch {
      return escapeHtml(parsed.visible).replace(/\n/g, '<br/>')
    }
  }, [parsed.visible])

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="selectable max-w-[78%] rounded-2xl rounded-br-md bg-user px-4 py-2.5 text-[14.5px] leading-relaxed text-user-fg shadow-sm shadow-shadow/10">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    )
  }

  const isEmpty = !parsed.visible && !parsed.thinking && !message.toolCalls?.length
  const showCursor = streaming && !message.done
  const showActivity =
    streaming && !message.done && message.activity && message.activity.kind !== 'idle'

  return (
    <div className="group flex gap-3">
      <img src={vibeLogoUrl} alt="Vibe Chat" className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover" />
      <div className="selectable min-w-0 flex-1">
        {parsed.thinking && (
          <ThinkingBlock content={parsed.thinking} inProgress={parsed.thinkingInProgress} />
        )}

        {message.toolCalls?.map((tc) => <ToolCallView key={tc.id} call={tc} />)}

        {!isEmpty && (
          <div
            className="markdown-body text-[14.5px] text-fg"
            dangerouslySetInnerHTML={{
              __html: html + (showCursor && parsed.visible ? '<span class="anim-caret">▍</span>' : '')
            }}
          />
        )}

        {showActivity && (
          <ActivityBar
            activity={message.activity!}
            startedAt={message.createdAt}
            toolCalls={message.toolCalls}
          />
        )}

        {isEmpty && showCursor && !showActivity && (
          <div className="dot-flashing text-muted">
            <span />
            <span />
            <span />
          </div>
        )}

        {onRegenerate && (
          <div className="mt-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={onRegenerate}
              className="rounded-md px-2 py-1 text-[11px] text-muted hover:bg-control hover:text-fg"
            >
              ↻ Regenerate
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(parsed.visible)}
              className="rounded-md px-2 py-1 text-[11px] text-muted hover:bg-control hover:text-fg"
            >
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const THINKING_VERBS = [
  'Thinking',
  'Considering',
  'Planning',
  'Pondering',
  'Reasoning',
  'Sketching'
]
const GENERATING_VERBS = ['Writing', 'Composing', 'Drafting']

function ActivityBar({
  activity,
  startedAt,
  toolCalls
}: {
  activity: AgentActivity
  startedAt: number
  toolCalls?: ToolCall[]
}) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000))
  const verbIdxRef = useRef(0)
  const [verbIdx, setVerbIdx] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [startedAt])

  useEffect(() => {
    if (activity.kind === 'thinking' || activity.kind === 'generating') {
      const id = window.setInterval(() => {
        verbIdxRef.current++
        setVerbIdx(verbIdxRef.current)
      }, 3500)
      return () => window.clearInterval(id)
    }
    return undefined
  }, [activity.kind])

  const label = useMemo(() => {
    if (activity.kind === 'thinking') {
      const verbs = THINKING_VERBS
      return verbs[verbIdx % verbs.length]
    }
    if (activity.kind === 'generating') {
      const verbs = GENERATING_VERBS
      return verbs[verbIdx % verbs.length]
    }
    if (activity.kind === 'tool') {
      const verb = toolVerb(activity.tool)
      return activity.target ? `${verb} ${activity.target}` : verb
    }
    return ''
  }, [activity, verbIdx])

  // Hide if there's already a running tool card that conveys the same state
  const hasRunningTool = toolCalls?.some((t) => t.running)
  if (hasRunningTool && activity.kind === 'tool') return null

  const chars = (activity as { chars?: number }).chars
  return (
    <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
      <span className="shimmer-text">{label}…</span>
      <span className="tabular-nums text-faint">
        {chars != null && chars > 0 ? `${chars.toLocaleString()} chars · ` : ''}
        {formatElapsed(elapsed)}
      </span>
    </div>
  )
}

function toolVerb(name: string): string {
  switch (name) {
    case 'write_file':
      return 'Writing'
    case 'read_file':
      return 'Reading'
    case 'edit_file':
      return 'Editing'
    case 'delete_file':
      return 'Deleting'
    case 'list_files':
      return 'Listing'
    case 'run_bash':
      return 'Running'
    case 'open_preview':
      return 'Revealing preview'
    case 'web_search':
      return 'Searching'
    case 'fetch_url':
      return 'Fetching'
    case 'calc':
      return 'Calculating'
    default:
      return 'Running ' + name
  }
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s}s`
}

function ThinkingBlock({
  content,
  inProgress
}: {
  content: string
  inProgress: boolean
}) {
  const [open, setOpen] = useState(inProgress)
  const labelClass = inProgress ? 'shimmer-text' : ''
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-line bg-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-muted hover:text-fg"
      >
        <svg
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 transition ${open ? 'rotate-90' : ''}`}
          fill="currentColor"
        >
          <path d="M4 2l4 4-4 4V2z" />
        </svg>
        <span className={labelClass}>{inProgress ? 'Thinking…' : 'Thought process'}</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-line px-3 py-2 text-[12.5px] leading-relaxed text-muted">
          {content}
        </div>
      )}
    </div>
  )
}

function toolLabel(call: ToolCall): { verb: string; target: string } {
  const a = call.args
  switch (call.name) {
    case 'write_file':
      return { verb: 'Writing', target: String(a.path ?? '') }
    case 'read_file':
      return { verb: 'Reading', target: String(a.path ?? '') }
    case 'edit_file':
      return { verb: 'Editing', target: String(a.path ?? '') }
    case 'delete_file':
      return { verb: 'Deleting', target: String(a.path ?? '') }
    case 'list_files':
      return { verb: 'Listing', target: 'workspace' }
    case 'run_bash':
      return { verb: 'Running', target: String(a.command ?? '').slice(0, 80) }
    case 'open_preview':
      return { verb: 'Opening', target: 'preview' }
    case 'web_search':
      return { verb: 'Searching', target: String(a.query ?? '') }
    case 'fetch_url':
      return { verb: 'Fetching', target: String(a.url ?? '') }
    case 'calc':
      return { verb: 'Calculating', target: String(a.expression ?? '') }
    default:
      return { verb: call.name, target: '' }
  }
}

function toolIcon(name: string): string {
  switch (name) {
    case 'write_file':
      return '✎'
    case 'read_file':
      return '⇠'
    case 'edit_file':
      return '✂'
    case 'delete_file':
      return '⊗'
    case 'list_files':
      return '☰'
    case 'run_bash':
      return '▸'
    case 'open_preview':
      return '◉'
    case 'web_search':
      return '⌕'
    case 'fetch_url':
      return '↗'
    case 'calc':
      return '∑'
    default:
      return '·'
  }
}

function ToolCallView({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const running = !!call.running
  const { verb, target } = toolLabel(call)
  const ico = toolIcon(call.name)
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-line bg-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-fg hover:bg-panel-strong"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center font-mono text-[13px]">
          {running ? (
            <svg className="h-3.5 w-3.5 animate-spin text-muted" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray="40 100"
              />
            </svg>
          ) : call.error ? (
            <span className="text-danger">×</span>
          ) : (
            <span className="text-success">{ico}</span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className={running ? 'shimmer-text' : 'text-fg'}>
            {running ? `${verb}…` : verb}
          </span>
          {target && (
            <span className="truncate font-mono text-[11.5px] text-muted">{target}</span>
          )}
        </span>
        <svg
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 shrink-0 text-muted transition ${open ? 'rotate-90' : ''}`}
          fill="currentColor"
        >
          <path d="M4 2l4 4-4 4V2z" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2 font-mono text-[11.5px] text-muted">
          {call.name === 'write_file' && typeof call.args.content === 'string' ? (
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-ink-200">
              {String(call.args.content).slice(0, 4000)}
              {String(call.args.content).length > 4000 ? '\n…' : ''}
            </pre>
          ) : (
            <div className="mb-1 text-muted">
              args: {JSON.stringify(call.args).slice(0, 400)}
              {JSON.stringify(call.args).length > 400 ? '…' : ''}
            </div>
          )}
          {call.result && (
            <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap break-words text-ink-200">
              {call.result}
            </pre>
          )}
          {call.error && <div className="text-danger">{call.error}</div>}
        </div>
      )}
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
