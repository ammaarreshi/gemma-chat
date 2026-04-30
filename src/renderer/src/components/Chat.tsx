import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type AgentMode, type ChatMessage, type ModelInfo, type ToolCall, type StreamChunk } from '@shared/types'
import gemmaLogoUrl from '../assets/gemma-logo.png'
import Composer from './Composer'
import Message from './Message'
import Sidebar from './Sidebar'
import Canvas from './Canvas'

interface Props {
  model: string
  models: ModelInfo[]
  onSwitchModel: (model: string) => void
}

interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  mode: AgentMode
  canvasOpen?: boolean
}

const STORAGE_KEY = 'gemma-chat:conversations:v2'

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Conversation[]
    return arr.map((c) => ({ ...c, mode: c.mode ?? 'code' }))
  } catch {
    return []
  }
}

function saveConversations(cs: Conversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cs))
  } catch {
    // ignore
  }
}

function newConversation(mode: AgentMode = 'code'): Conversation {
  return {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: 'New chat',
    messages: [],
    createdAt: Date.now(),
    mode,
    canvasOpen: mode === 'code'
  }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export default function Chat({ model, models, onSwitchModel }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations()
    return loaded.length ? loaded : [newConversation()]
  })
  const [activeId, setActiveId] = useState<string>(() => conversations[0].id)
  const [streaming, setStreaming] = useState(false)
  const streamRef = useRef<{ abort: boolean }>({ abort: false })

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId]
  )

  useEffect(() => {
    saveConversations(conversations)
  }, [conversations])

  function updateActive(fn: (c: Conversation) => Conversation): void {
    setConversations((cs) => cs.map((c) => (c.id === activeId ? fn(c) : c)))
  }

  function createConversation(mode: AgentMode = 'code'): void {
    const c = newConversation(mode)
    setConversations((cs) => [c, ...cs])
    setActiveId(c.id)
  }

  function deleteConversation(id: string): void {
    setConversations((cs) => {
      const filtered = cs.filter((c) => c.id !== id)
      if (filtered.length === 0) {
        const nc = newConversation()
        setActiveId(nc.id)
        return [nc]
      }
      if (id === activeId) setActiveId(filtered[0].id)
      return filtered
    })
  }

  function toggleMode(): void {
    updateActive((c) => {
      const nextMode: AgentMode = c.mode === 'code' ? 'chat' : 'code'
      return { ...c, mode: nextMode, canvasOpen: nextMode === 'code' }
    })
  }

  function toggleCanvas(): void {
    updateActive((c) => ({ ...c, canvasOpen: !c.canvasOpen }))
  }

  async function handleSend(input: string): Promise<void> {
    if (!input.trim() || streaming) return

    const conv = conversations.find((c) => c.id === activeId)!

    const userMsg: ChatMessage = {
      id: newId('m'),
      role: 'user',
      content: input,
      createdAt: Date.now()
    }
    const assistantMsg: ChatMessage = {
      id: newId('m'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      model,
      toolCalls: [],
      activity: { kind: 'thinking' }
    }

    updateActive((c) => {
      const title =
        c.messages.length === 0
          ? input.slice(0, 48) + (input.length > 48 ? '…' : '')
          : c.title
      return { ...c, title, messages: [...c.messages, userMsg, assistantMsg] }
    })

    const history = [...conv.messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls
    }))

    setStreaming(true)
    streamRef.current.abort = false

    try {
      await window.api.sendChat(
        {
          conversationId: activeId,
          messages: history,
          model,
          enableTools: true,
          mode: conv.mode
        },
        (chunk: StreamChunk) => {
          if (streamRef.current.abort) return
          setConversations((cs) =>
            cs.map((c) => {
              if (c.id !== activeId) return c
              const msgs = [...c.messages]
              const last = msgs[msgs.length - 1]
              if (!last || last.role !== 'assistant') return c
              if (chunk.type === 'token') {
                msgs[msgs.length - 1] = { ...last, content: last.content + chunk.text }
              } else if (chunk.type === 'tool_call') {
                const tc: ToolCall = { ...chunk.call, running: true }
                msgs[msgs.length - 1] = {
                  ...last,
                  toolCalls: [...(last.toolCalls ?? []), tc]
                }
              } else if (chunk.type === 'tool_result') {
                const tcs = (last.toolCalls ?? []).map((t) =>
                  t.id === chunk.id
                    ? { ...t, running: false, result: chunk.result, error: chunk.error }
                    : t
                )
                msgs[msgs.length - 1] = { ...last, toolCalls: tcs }
              } else if (chunk.type === 'activity') {
                msgs[msgs.length - 1] = { ...last, activity: chunk.activity }
              } else if (chunk.type === 'done') {
                msgs[msgs.length - 1] = { ...last, done: true, activity: { kind: 'idle' } }
              } else if (chunk.type === 'error') {
                msgs[msgs.length - 1] = {
                  ...last,
                  done: true,
                  activity: { kind: 'idle' },
                  content:
                    last.content + (last.content ? '\n\n' : '') + `⚠️ ${chunk.error}`
                }
              }
              return { ...c, messages: msgs }
            })
          )
        }
      )
    } finally {
      setStreaming(false)
    }
  }

  async function handleStop(): Promise<void> {
    streamRef.current.abort = true
    await window.api.abortChat(activeId)
    setStreaming(false)
  }

  async function handleRegenerate(): Promise<void> {
    if (streaming) return
    const conv = conversations.find((c) => c.id === activeId)
    if (!conv) return
    const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    updateActive((c) => {
      const msgs = [...c.messages]
      while (msgs.length && msgs[msgs.length - 1].role !== 'user') {
        msgs.pop()
      }
      return { ...c, messages: msgs.slice(0, -1) }
    })
    setTimeout(() => handleSend(lastUser.content), 0)
  }

  const canvasVisible =
    (activeConversation.mode === 'code' || activeConversation.canvasOpen === true) &&
    activeConversation.canvasOpen !== false

  return (
    <div className="flex h-full w-full">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => createConversation(activeConversation.mode)}
        onDelete={deleteConversation}
      />
      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            model={model}
            models={models}
            mode={activeConversation.mode}
            canvasOpen={!!activeConversation.canvasOpen}
            onToggleMode={toggleMode}
            onToggleCanvas={toggleCanvas}
            onSwitchModel={onSwitchModel}
          />
          <MessageList
            messages={activeConversation.messages}
            streaming={streaming}
            mode={activeConversation.mode}
            onRegenerate={handleRegenerate}
          />
          <Composer
            onSend={handleSend}
            onStop={handleStop}
            streaming={streaming}
            disabled={false}
            model={model}
            placeholder={
              activeConversation.mode === 'code'
                ? 'Describe what to build — a webpage, component, or script…'
                : 'Message Gemma…'
            }
          />
        </div>
        {canvasVisible && (
          <ResizableCanvas
            conversationId={activeId}
            streaming={streaming}
            onClose={() => updateActive((c) => ({ ...c, canvasOpen: false }))}
          />
        )}
      </div>
    </div>
  )
}

function ResizableCanvas({
  conversationId,
  streaming,
  onClose
}: {
  conversationId: string
  streaming: boolean
  onClose: () => void
}) {
  const [width, setWidth] = useState(520)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startW.current = width
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const delta = startX.current - e.clientX
    const next = Math.max(320, Math.min(startW.current + delta, 900))
    setWidth(next)
  }, [])

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  return (
    <div
      className="anim-slide-right relative shrink-0"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize select-none transition-colors hover:bg-white/10 active:bg-white/20"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ touchAction: 'none' }}
      />
      <Canvas
        conversationId={conversationId}
        streaming={streaming}
        onClose={onClose}
      />
    </div>
  )
}

function Header({
  model,
  models,
  mode,
  canvasOpen,
  onToggleMode,
  onToggleCanvas,
  onSwitchModel
}: {
  model: string
  models: ModelInfo[]
  mode: AgentMode
  canvasOpen: boolean
  onToggleMode: () => void
  onToggleCanvas: () => void
  onSwitchModel: (model: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!pickerOpen) return
    function handleClick(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerOpen])

  const currentLabel = models.find((m) => m.name === model)?.label ?? model

  return (
    <div className="drag flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
      <div className="min-w-[8rem]" />
      <div className="no-drag flex items-center gap-1 rounded-lg bg-white/[0.04] p-0.5 text-[12px]">
        <ModePill active={mode === 'chat'} onClick={() => mode === 'code' && onToggleMode()}>
          Chat
        </ModePill>
        <ModePill active={mode === 'code'} onClick={() => mode === 'chat' && onToggleMode()}>
          Build
        </ModePill>
      </div>
      <div className="no-drag flex shrink-0 items-center justify-end gap-2">
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] text-ink-400 transition-all duration-200 hover:bg-white/[0.05] hover:text-ink-100"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {currentLabel}
            <svg viewBox="0 0 16 16" className={`h-3 w-3 transition-transform duration-200 ${pickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {pickerOpen && (
            <div className="anim-fade-scale absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-white/10 bg-[#1a1a1a] p-1.5 shadow-2xl backdrop-blur-xl">
              <div className="mb-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
                Switch model
              </div>
              {models.map((m) => (
                <button
                  key={m.name}
                  onClick={() => {
                    setPickerOpen(false)
                    if (m.name !== model) onSwitchModel(m.name)
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-all duration-150 ${
                    m.name === model
                      ? 'bg-white/[0.07] text-white'
                      : 'text-ink-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      {m.label}
                      {m.recommended && (
                        <span className="rounded-full bg-white/10 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-ink-200">
                          rec
                        </span>
                      )}
                      {m.provider === 'ollama' && (
                        <span className="rounded-full bg-emerald-400/10 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-emerald-200">
                          ollama
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-400">{m.size}</div>
                  </div>
                  {m.name === model && (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        {mode === 'code' && (
          <button
            onClick={onToggleCanvas}
            title={canvasOpen ? 'Hide canvas' : 'Show canvas'}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
              canvasOpen ? 'bg-white/10 text-white' : 'text-ink-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M9 3v10" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

function ModePill({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 font-medium transition-all duration-200 ease-out ${
        active ? 'bg-white/10 text-white shadow-sm scale-[1.02]' : 'text-ink-400 hover:text-ink-100 scale-100'
      }`}
    >
      {children}
    </button>
  )
}

function MessageList({
  messages,
  streaming,
  mode,
  onRegenerate
}: {
  messages: ChatMessage[]
  streaming: boolean
  mode: AgentMode
  onRegenerate: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (atBottomRef.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [messages])

  const empty = messages.length === 0

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">
      {empty ? (
        <EmptyState mode={mode} />
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
          {messages.map((m, i) => (
            <div key={m.id} className="anim-float-in" style={{ animationDelay: `${Math.min(i * 30, 150)}ms` }}>
              <Message
                message={m}
                isLast={i === messages.length - 1}
                streaming={streaming && i === messages.length - 1}
                onRegenerate={
                  !streaming && m.role === 'assistant' && i === messages.length - 1
                    ? onRegenerate
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ mode }: { mode: AgentMode }) {
  const chatSuggestions = [
    { title: 'Search the web', prompt: 'What are the top AI news stories this week?' },
    { title: 'Explain a concept', prompt: 'Explain the transformer architecture in plain English.' },
    { title: 'Plan a trip', prompt: 'Help me plan a weekend trip to Tokyo for 4 days.' },
    { title: 'Debug code', prompt: 'Why is this JS promise not resolving? (paste code)' }
  ]
  const codeSuggestions = [
    {
      title: 'Landing page',
      prompt: 'Build a one-page landing site for a fake AI dog-walking app. Modern design, dark mode.'
    },
    {
      title: 'Pomodoro timer',
      prompt: 'Build a pomodoro timer web app with start/pause/reset buttons and a minimal UI.'
    },
    {
      title: 'Retro snake game',
      prompt: 'Make a playable snake game in a single index.html with keyboard controls.'
    },
    {
      title: 'Markdown preview',
      prompt: 'Build a live markdown editor — textarea on the left, rendered output on the right.'
    }
  ]
  const suggestions = mode === 'code' ? codeSuggestions : chatSuggestions
  return (
    <div className="anim-fade-in flex h-full flex-col items-center justify-center px-8">
      <div className="anim-fade-up mb-12 text-center">
        <img src={gemmaLogoUrl} alt="Gemma" className="mx-auto mb-6 h-20 w-20" draggable={false} />
        <div className="mb-3 text-[32px] font-semibold tracking-tight text-white">
          {mode === 'code' ? 'What should we build?' : 'How can I help?'}
        </div>
        <div className="text-sm text-ink-400">
          {mode === 'code'
            ? 'Gemma will write files into a workspace and show a live preview on the right.'
            : 'Running locally. Your messages never leave your Mac.'}
        </div>
      </div>
      <div className="anim-stagger grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.title}
            onClick={() => {
              const ta = document.querySelector<HTMLTextAreaElement>('[data-composer]')
              if (ta) {
                const setter = Object.getOwnPropertyDescriptor(
                  window.HTMLTextAreaElement.prototype,
                  'value'
                )?.set
                setter?.call(ta, s.prompt)
                ta.dispatchEvent(new Event('input', { bubbles: true }))
                ta.focus()
              }
            }}
            className="anim-fade-up rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/10 hover:bg-white/[0.04] active:scale-[0.98]"
          >
            <div className="text-sm font-medium text-white">{s.title}</div>
            <div className="mt-0.5 text-[12.5px] text-ink-400">{s.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
