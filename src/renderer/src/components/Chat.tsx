import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AVAILABLE_MODELS,
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_MODEL_PREFIX,
  runtimeModelName,
  type AgentMode,
  type AppProviderConfig,
  type ChatMessage,
  type ConversationDesign,
  type DesignCatalogItem,
  type PiAiAuthEvent,
  type PiAiAuthMode,
  type PiAiAuthStatus,
  type PiAiModelSummary,
  type PiAiProviderConfig,
  type PiAiProviderInfo,
  type ToolCall,
  type StreamChunk
} from '@shared/types'
import vibeLogoUrl from '../assets/vibe-logo.png'
import type { ThemeMode } from '../theme'
import Composer from './Composer'
import Message from './Message'
import Sidebar from './Sidebar'
import Canvas from './Canvas'

interface Props {
  model: string
  providerConfig: AppProviderConfig
  theme: ThemeMode
  onToggleTheme: () => void
  onSwitchModel: (model: string) => void
  onProviderConfigChange: (config: AppProviderConfig) => Promise<void>
}

interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  mode: AgentMode
  canvasOpen?: boolean
  design?: ConversationDesign
}

const STORAGE_KEY = 'vibe-chat:conversations:v2'
const LEGACY_STORAGE_KEY = 'gemma-chat:conversations:v2'

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as Conversation[]
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, raw)
    }
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

function providerDisplayLabel(config: AppProviderConfig): string {
  if (config.selectedProvider === 'pi-ai') {
    return `${config.piAi.providerId}/${config.piAi.modelId}`
  }
  if (config.selectedProvider === 'ollama') {
    return `Ollama/${runtimeModelName(config.ollamaModel)}`
  }
  return 'local'
}

export default function Chat({
  model,
  providerConfig,
  theme,
  onToggleTheme,
  onSwitchModel,
  onProviderConfigChange
}: Props) {
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
      model:
        providerConfig.selectedProvider === 'pi-ai'
          ? `${providerConfig.piAi.providerId}/${providerConfig.piAi.modelId}`
          : providerConfig.selectedProvider === 'ollama'
            ? providerConfig.ollamaModel
            : model,
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
          provider:
            providerConfig.selectedProvider === 'pi-ai'
              ? { id: 'pi-ai', config: providerConfig.piAi }
              : providerConfig.selectedProvider === 'ollama'
                ? { id: 'ollama', model: providerConfig.ollamaModel }
                : { id: 'local-mlx', model },
          enableTools: true,
          mode: conv.mode,
          design: conv.mode === 'code' ? conv.design : undefined
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

  async function handleInstallDesign(slug: string): Promise<void> {
    const design = await window.api.installDesign(activeId, slug)
    updateActive((c) => ({ ...c, mode: 'code', canvasOpen: true, design }))
  }

  async function handleClearDesign(): Promise<void> {
    const slug = activeConversation.design?.slug
    await window.api.clearDesign(activeId, slug)
    updateActive((c) => ({ ...c, design: undefined }))
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
    <div className="flex h-full w-full bg-app text-fg">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        providerLabel={
          providerConfig.selectedProvider === 'pi-ai'
            ? 'Pi AI'
            : providerConfig.selectedProvider === 'ollama'
              ? 'Ollama'
              : 'Local'
        }
        onSelect={setActiveId}
        onNew={() => createConversation(activeConversation.mode)}
        onDelete={deleteConversation}
      />
      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            model={model}
            providerConfig={providerConfig}
            mode={activeConversation.mode}
            canvasOpen={!!activeConversation.canvasOpen}
            design={activeConversation.design}
            theme={theme}
            onToggleMode={toggleMode}
            onToggleCanvas={toggleCanvas}
            onToggleTheme={onToggleTheme}
            onSwitchModel={onSwitchModel}
            onProviderConfigChange={onProviderConfigChange}
            onInstallDesign={handleInstallDesign}
            onClearDesign={handleClearDesign}
          />
          <MessageList
            messages={activeConversation.messages}
            streaming={streaming}
            mode={activeConversation.mode}
            providerLabel={providerDisplayLabel(providerConfig)}
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
                : providerConfig.selectedProvider === 'pi-ai'
                  ? 'Message your selected Pi AI provider…'
                  : providerConfig.selectedProvider === 'ollama'
                    ? 'Message your local Ollama model…'
                    : 'Message Vibe…'
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
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize select-none transition-colors hover:bg-sidebar-active/30 active:bg-sidebar-active/50"
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
  providerConfig,
  mode,
  canvasOpen,
  design,
  theme,
  onToggleMode,
  onToggleCanvas,
  onToggleTheme,
  onSwitchModel,
  onProviderConfigChange,
  onInstallDesign,
  onClearDesign
}: {
  model: string
  providerConfig: AppProviderConfig
  mode: AgentMode
  canvasOpen: boolean
  design?: ConversationDesign
  theme: ThemeMode
  onToggleMode: () => void
  onToggleCanvas: () => void
  onToggleTheme: () => void
  onSwitchModel: (model: string) => void
  onProviderConfigChange: (config: AppProviderConfig) => Promise<void>
  onInstallDesign: (slug: string) => Promise<void>
  onClearDesign: () => Promise<void>
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

  const currentLabel =
    providerConfig.selectedProvider === 'pi-ai'
      ? `${providerConfig.piAi.providerId} · ${providerConfig.piAi.modelId}`
      : providerConfig.selectedProvider === 'ollama'
        ? `Ollama · ${runtimeModelName(providerConfig.ollamaModel)}`
        : (AVAILABLE_MODELS.find((m) => m.name === model)?.label ?? model)

  return (
    <div className="drag flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
      <div className="min-w-[8rem]" />
      <div className="no-drag flex items-center gap-1 rounded-lg bg-control p-0.5 text-[12px]">
        <ModePill active={mode === 'chat'} onClick={() => mode === 'code' && onToggleMode()}>
          Chat
        </ModePill>
        <ModePill active={mode === 'code'} onClick={() => mode === 'chat' && onToggleMode()}>
          Build
        </ModePill>
      </div>
      <div className="no-drag flex shrink-0 items-center justify-end gap-2">
        {mode === 'code' && (
          <DesignMenu
            selected={design}
            onSelect={onInstallDesign}
            onClear={onClearDesign}
          />
        )}
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] text-muted transition-all duration-200 hover:bg-control-hover hover:text-fg"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
            {currentLabel}
            <svg viewBox="0 0 16 16" className={`h-3 w-3 transition-transform duration-200 ${pickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {pickerOpen && (
            <ProviderPicker
              model={model}
              providerConfig={providerConfig}
              onSwitchModel={(nextModel) => {
                setPickerOpen(false)
                onSwitchModel(nextModel)
              }}
              onProviderConfigChange={onProviderConfigChange}
            />
          )}
        </div>
        {mode === 'code' && (
          <button
            onClick={onToggleCanvas}
            title={canvasOpen ? 'Hide canvas' : 'Show canvas'}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
              canvasOpen ? 'bg-control-hover text-fg' : 'text-muted hover:bg-control hover:text-fg'
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

function DesignMenu({
  selected,
  onSelect,
  onClear
}: {
  selected?: ConversationDesign
  onSelect: (slug: string) => Promise<void>
  onClear: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [designs, setDesigns] = useState<DesignCatalogItem[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    if (!open || designs.length > 0) return
    window.api
      .listDesigns()
      .then((items) => setDesigns(items))
      .catch((e) => setError((e as Error).message))
  }, [designs.length, open])

  const categories = useMemo(() => {
    return ['All', ...Array.from(new Set(designs.map((design) => design.category)))]
  }, [designs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return designs.filter((design) => {
      if (category !== 'All' && design.category !== category) return false
      if (!q) return true
      return [design.name, design.slug, design.description, design.category]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [category, designs, query])

  async function selectDesign(slug: string): Promise<void> {
    setBusySlug(slug)
    setError(null)
    try {
      await onSelect(slug)
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusySlug(null)
    }
  }

  async function clearDesign(): Promise<void> {
    setClearing(true)
    setError(null)
    try {
      await onClear()
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition ${
          selected
            ? 'border-sidebar-active/70 bg-control-hover text-fg'
            : 'border-line bg-panel text-muted hover:bg-panel-strong hover:text-fg'
        }`}
        title={selected ? `Design: ${selected.name}` : 'Design: None'}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4.5h10M3 8h10M3 11.5h6" strokeLinecap="round" />
          <path d="M11 10.5l1 1 2-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="max-w-[9rem] truncate">
          Design: {selected ? selected.name : 'None'}
        </span>
      </button>

      {open && (
        <div className="anim-fade-scale absolute right-0 top-full z-50 mt-1 w-[460px] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-shadow/30 backdrop-blur-xl">
          <div className="border-b border-line p-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <svg viewBox="0 0 16 16" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="7" cy="7" r="4" />
                  <path d="M10.5 10.5L14 14" strokeLinecap="round" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search designs"
                  className="h-8 w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-[12px] text-fg outline-none placeholder:text-faint focus:border-sidebar-active"
                />
              </div>
              {selected && (
                <button
                  onClick={clearDesign}
                  disabled={clearing || !!busySlug}
                  className="h-8 rounded-lg border border-line bg-control px-3 text-[12px] text-muted hover:bg-control-hover hover:text-fg disabled:opacity-50"
                >
                  {clearing ? 'Clearing...' : 'Clear'}
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-medium transition ${
                    category === cat
                      ? 'bg-sidebar-active text-white'
                      : 'bg-control text-muted hover:bg-control-hover hover:text-fg'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[52vh] overflow-y-auto p-2">
            {designs.length === 0 && !error && (
              <div className="p-6 text-center text-[12px] text-muted">Loading designs...</div>
            )}
            {filtered.length === 0 && designs.length > 0 && (
              <div className="p-6 text-center text-[12px] text-muted">No matching designs.</div>
            )}
            {filtered.map((design) => {
              const active = selected?.slug === design.slug
              const busy = busySlug === design.slug
              return (
                <div
                  key={design.slug}
                  className={`group rounded-lg border p-2 transition ${
                    active
                      ? 'border-sidebar-active bg-control-hover'
                      : 'border-transparent hover:border-line hover:bg-control'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => selectDesign(design.slug)}
                      disabled={!!busySlug || clearing}
                      className="min-w-0 flex-1 text-left disabled:opacity-60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-medium text-fg">
                          {design.name}
                        </span>
                        {active && (
                          <span className="rounded-full bg-sidebar-active px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-white">
                            selected
                          </span>
                        )}
                        {busy && (
                          <span className="text-[10px] text-muted">installing...</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">{design.category}</div>
                      <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-300">
                        {design.description}
                      </div>
                    </button>
                    <a
                      href={design.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md px-2 py-1 text-[10.5px] text-faint transition hover:bg-panel-strong hover:text-fg"
                    >
                      View source
                    </a>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="border-t border-line px-3 py-2 text-[10.5px] text-faint">
            Inspired design reference, not official.
            {error && <span className="ml-2 text-danger">{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function ThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      onClick={onToggle}
      title={`Switch to ${next} theme`}
      className="flex h-7 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[11px] font-medium text-muted transition hover:bg-panel-strong hover:text-fg"
    >
      <span className="relative flex h-3 w-3 items-center justify-center">
        <span className={`absolute h-2.5 w-2.5 rounded-full ${theme === 'dark' ? 'bg-accent-yellow' : 'bg-accent-aubergine'}`} />
        {theme === 'dark' && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-panel" />}
      </span>
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}

function ProviderPicker({
  model,
  providerConfig,
  onSwitchModel,
  onProviderConfigChange
}: {
  model: string
  providerConfig: AppProviderConfig
  onSwitchModel: (model: string) => void
  onProviderConfigChange: (config: AppProviderConfig) => Promise<void>
}) {
  const [piProviders, setPiProviders] = useState<PiAiProviderInfo[]>([])
  const [models, setModels] = useState<PiAiModelSummary[]>([])
  const [draft, setDraft] = useState<PiAiProviderConfig>(providerConfig.piAi)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [draftOllamaModel, setDraftOllamaModel] = useState(
    providerConfig.ollamaModel || DEFAULT_OLLAMA_MODEL
  )
  const [authStatus, setAuthStatus] = useState<PiAiAuthStatus | null>(null)
  const [authUrl, setAuthUrl] = useState<{ url: string; instructions?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const apiKeyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(providerConfig.piAi)
  }, [providerConfig.piAi])

  useEffect(() => {
    setDraftOllamaModel(providerConfig.ollamaModel || DEFAULT_OLLAMA_MODEL)
  }, [providerConfig.ollamaModel])

  useEffect(() => {
    window.api.listProviders().then((res) => setPiProviders(res.piAiProviders)).catch(() => {
      setPiProviders([])
    })
    window.api
      .listLocalModels()
      .then((local) => {
        setOllamaModels(local.filter((m) => m.startsWith(OLLAMA_MODEL_PREFIX)))
      })
      .catch(() => setOllamaModels([]))
  }, [])

  useEffect(() => {
    if (draft.providerId === 'custom-openai-compatible') {
      setModels([])
      return
    }
    window.api.listPiAiModels(draft.providerId).then(setModels).catch(() => setModels([]))
  }, [draft.providerId])

  useEffect(() => {
    if (!draft.modelId && models[0]) {
      setDraft((prev) => ({ ...prev, modelId: models[0].id }))
    }
  }, [draft.modelId, models])

  useEffect(() => {
    let cancelled = false
    window.api
      .getProviderAuthStatus(draft)
      .then((status) => {
        if (!cancelled) setAuthStatus(status)
      })
      .catch((e) => {
        if (!cancelled) {
          setAuthStatus({
            providerId: draft.providerId,
            authMode: draft.authMode,
            ready: false,
            hasStoredCredential: false,
            supportsOAuth: false,
            message: (e as Error).message
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [draft])

  useEffect(() => {
    return window.api.onProviderAuthEvent((ev: PiAiAuthEvent) => {
      if (ev.type === 'auth') {
        setAuthUrl({ url: ev.url, instructions: ev.instructions })
        setMessage(ev.instructions ?? 'Continue in your browser to finish sign-in.')
      } else if (ev.type === 'progress') {
        setMessage(ev.message)
      } else if (ev.type === 'prompt') {
        const answer = window.prompt(ev.message, '')
        window.api.respondProviderAuthPrompt(ev.promptId, answer ?? '')
      } else if (ev.type === 'complete') {
        setAuthStatus(ev.status)
        setMessage(ev.status.message ?? 'Signed in.')
        setBusy(null)
      } else if (ev.type === 'error') {
        setMessage(ev.error)
        setBusy(null)
      }
    })
  }, [])

  const selectedProvider = piProviders.find((p) => p.id === draft.providerId)
  const showCompat = draft.providerId === 'custom-openai-compatible' || !!draft.baseUrl

  function updateDraft(patch: Partial<PiAiProviderConfig>): void {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  async function saveRuntime(selectedProviderId: AppProviderConfig['selectedProvider']): Promise<void> {
    setBusy('save')
    setMessage(null)
    try {
      await onProviderConfigChange({
        ...providerConfig,
        selectedProvider: selectedProviderId,
        localModel: model,
        ollamaModel: draftOllamaModel,
        piAi: draft
      })
      if (selectedProviderId === 'local-mlx' && providerConfig.selectedProvider !== 'local-mlx') {
        window.api.startSetup(model)
      }
      setMessage('Saved.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function saveApiKey(): Promise<void> {
    const key = apiKeyRef.current?.value ?? ''
    setBusy('key')
    setMessage(null)
    try {
      const status = await window.api.setProviderApiKey(draft, key)
      setAuthStatus(status)
      if (apiKeyRef.current) apiKeyRef.current.value = ''
      setMessage(status.message ?? 'API key saved.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function loginOAuth(): Promise<void> {
    setBusy('oauth')
    setAuthUrl(null)
    setMessage('Starting sign-in...')
    try {
      const status = await window.api.loginProviderOAuth(draft)
      setAuthStatus(status)
      setMessage(status.message ?? 'Signed in.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function clearAuth(): Promise<void> {
    setBusy('clear')
    setMessage(null)
    try {
      const status = await window.api.clearProviderAuth(draft)
      setAuthStatus(status)
      setMessage(status.message ?? 'Credentials cleared.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function refreshAuth(): Promise<void> {
    setBusy('refresh')
    setMessage(null)
    try {
      const status = await window.api.refreshProviderAuth(draft)
      setAuthStatus(status)
      setMessage(status.message ?? 'Credentials refreshed.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function testConnection(): Promise<void> {
    setBusy('test')
    setMessage(null)
    try {
      await window.api.testProviderAuth(draft)
      setMessage('Connection works.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="anim-fade-scale absolute right-0 top-full z-50 mt-1 w-[420px] rounded-xl border border-line bg-panel p-2 shadow-2xl shadow-shadow/30 backdrop-blur-xl">
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-lg bg-control p-1 text-[12px]">
        <button
          onClick={() => saveRuntime('local-mlx')}
          className={`rounded-md px-2 py-1.5 font-medium transition ${
            providerConfig.selectedProvider === 'local-mlx'
              ? 'bg-sidebar-active text-white'
              : 'text-muted hover:bg-control-hover hover:text-fg'
          }`}
        >
          Local MLX
        </button>
        <button
          onClick={() => saveRuntime('ollama')}
          className={`rounded-md px-2 py-1.5 font-medium transition ${
            providerConfig.selectedProvider === 'ollama'
              ? 'bg-sidebar-active text-white'
              : 'text-muted hover:bg-control-hover hover:text-fg'
          }`}
        >
          Ollama
        </button>
        <button
          onClick={() => saveRuntime('pi-ai')}
          className={`rounded-md px-2 py-1.5 font-medium transition ${
            providerConfig.selectedProvider === 'pi-ai'
              ? 'bg-sidebar-active text-white'
              : 'text-muted hover:bg-control-hover hover:text-fg'
          }`}
        >
          Pi AI Provider
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <div className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-faint">
          Local models
        </div>
        <div className="space-y-1">
          {AVAILABLE_MODELS.filter((m) => m.provider === 'mlx').map((m) => (
            <button
              key={m.name}
              onClick={() => {
                if (m.name !== model) onSwitchModel(m.name)
              }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-all duration-150 ${
                providerConfig.selectedProvider === 'local-mlx' && m.name === model
                  ? 'bg-control-hover text-fg'
                  : 'text-ink-200 hover:bg-control'
              }`}
            >
              <div>
                <div className="text-[12.5px] font-medium">{m.label}</div>
                <div className="mt-0.5 text-[11px] text-muted">{m.size}</div>
              </div>
              {m.recommended && (
                <span className="rounded-full bg-control px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-ink-200">
                  rec
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-faint">
            Ollama
          </div>
          <label className="block text-[11px] text-muted">
            Model
            <select
              value={draftOllamaModel}
              onChange={(e) => setDraftOllamaModel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-[12px] text-fg outline-none focus:border-sidebar-active"
            >
              <option value={draftOllamaModel}>
                {runtimeModelName(draftOllamaModel)}
              </option>
              {ollamaModels
                .filter((m) => m !== draftOllamaModel)
                .map((m) => (
                  <option key={m} value={m}>
                    {runtimeModelName(m)}
                  </option>
                ))}
            </select>
          </label>
          <input
            value={draftOllamaModel}
            onChange={(e) => setDraftOllamaModel(e.target.value)}
            placeholder="ollama:gemma4:31b"
            className="mt-2 w-full rounded-lg border border-line bg-surface px-2 py-2 text-[12px] text-fg outline-none placeholder:text-faint focus:border-sidebar-active"
          />
          <p className="mt-2 rounded-lg border border-line bg-control p-2 text-[11px] text-ink-300">
            Start Ollama and install a model first, for example: <code>ollama pull gemma4:31b</code>.
          </p>
          <button
            onClick={() => saveRuntime('ollama')}
            disabled={!!busy || !draftOllamaModel.trim()}
            className="mt-2 rounded-lg bg-action px-3 py-2 text-[12px] font-medium text-action-fg hover:opacity-90 disabled:opacity-50"
          >
            Save Ollama
          </button>
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-faint">
            Pi AI
          </div>
          <label className="block text-[11px] text-muted">
            Provider
            <select
              value={draft.providerId}
              onChange={(e) => {
                const provider = piProviders.find((p) => p.id === e.target.value)
                updateDraft({
                  providerId: e.target.value,
                  authMode: provider?.defaultAuthMode ?? 'api-key',
                  modelId: e.target.value === 'custom-openai-compatible' ? draft.modelId : ''
                })
              }}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-[12px] text-fg outline-none focus:border-sidebar-active"
            >
              {piProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          {draft.providerId === 'openai' && (
            <p className="mt-2 rounded-lg border border-line bg-control p-2 text-[11px] text-ink-300">
              Uses OpenAI API key.
            </p>
          )}
          {draft.providerId === 'openai-codex' && (
            <p className="mt-2 rounded-lg border border-line bg-control p-2 text-[11px] text-ink-300">
              Uses ChatGPT/Codex subscription OAuth, not OpenAI API key billing.
            </p>
          )}

          <label className="mt-3 block text-[11px] text-muted">
            Catalog model
            <select
              value={models.some((m) => m.id === draft.modelId) ? draft.modelId : ''}
              onChange={(e) => updateDraft({ modelId: e.target.value })}
              disabled={models.length === 0}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-[12px] text-fg outline-none focus:border-sidebar-active disabled:opacity-50"
            >
              <option value="">Custom model id</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-2 block text-[11px] text-muted">
            Model id
            <input
              value={draft.modelId}
              onChange={(e) => updateDraft({ modelId: e.target.value })}
              placeholder={models[0]?.id ?? 'model-id'}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-[12px] text-fg outline-none placeholder:text-faint focus:border-sidebar-active"
            />
          </label>

          <label className="mt-2 block text-[11px] text-muted">
            Auth method
            <select
              value={draft.authMode}
              onChange={(e) => updateDraft({ authMode: e.target.value as PiAiAuthMode })}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-[12px] text-fg outline-none focus:border-sidebar-active"
            >
              <option value="api-key">API key</option>
              <option value="oauth" disabled={!selectedProvider?.supportsOAuth}>
                OAuth
              </option>
              <option value="env">Environment</option>
              <option value="none">None</option>
            </select>
          </label>

          {draft.authMode === 'api-key' && (
            <div className="mt-2 flex gap-2">
              <input
                ref={apiKeyRef}
                type="password"
                autoComplete="off"
                placeholder="Paste API key"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-2 text-[12px] text-fg outline-none placeholder:text-faint focus:border-sidebar-active"
              />
              <button
                onClick={saveApiKey}
                disabled={!!busy}
                className="rounded-lg border border-line bg-control px-3 text-[12px] text-fg hover:bg-control-hover disabled:opacity-50"
              >
                Save key
              </button>
            </div>
          )}

          {draft.authMode === 'oauth' && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={loginOAuth}
                disabled={!!busy || !selectedProvider?.supportsOAuth}
                className="rounded-lg border border-line bg-control px-3 py-2 text-[12px] text-fg hover:bg-control-hover disabled:opacity-50"
              >
                Sign in
              </button>
              {authUrl && (
                <button
                  onClick={() => window.api.openProviderAuthUrl(authUrl.url)}
                  className="rounded-lg border border-line bg-panel-strong px-3 py-2 text-[12px] text-fg hover:bg-control-hover"
                >
                  Open browser
                </button>
              )}
              {authStatus?.hasStoredCredential && (
                <button
                  onClick={refreshAuth}
                  disabled={!!busy}
                  className="rounded-lg border border-line bg-panel-strong px-3 py-2 text-[12px] text-fg hover:bg-control-hover disabled:opacity-50"
                >
                  Refresh
                </button>
              )}
            </div>
          )}

          <label className="mt-3 block text-[11px] text-muted">
            Base URL
            <input
              value={draft.baseUrl ?? ''}
              onChange={(e) => updateDraft({ baseUrl: e.target.value || undefined })}
              placeholder="https://api.example.com/v1"
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-2 text-[12px] text-fg outline-none placeholder:text-faint focus:border-sidebar-active"
            />
          </label>

          {showCompat && (
            <div className="mt-2 rounded-lg border border-line bg-control p-2">
              <div className="mb-1 text-[11px] font-medium text-ink-300">OpenAI-compatible compat</div>
              <CompatToggle
                label="No developer role"
                checked={draft.compat?.supportsDeveloperRole === false}
                onChange={(checked) =>
                  updateDraft({
                    compat: {
                      ...draft.compat,
                      supportsDeveloperRole: checked ? false : undefined
                    }
                  })
                }
              />
              <CompatToggle
                label="No reasoning effort"
                checked={draft.compat?.supportsReasoningEffort === false}
                onChange={(checked) =>
                  updateDraft({
                    compat: {
                      ...draft.compat,
                      supportsReasoningEffort: checked ? false : undefined
                    }
                  })
                }
              />
              <label className="mt-1 block text-[11px] text-muted">
                Max tokens field
                <select
                  value={draft.compat?.maxTokensField ?? ''}
                  onChange={(e) =>
                    updateDraft({
                      compat: {
                        ...draft.compat,
                        maxTokensField:
                          e.target.value === 'max_tokens' ||
                          e.target.value === 'max_completion_tokens'
                            ? e.target.value
                            : undefined
                      }
                    })
                  }
                  className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] text-fg"
                >
                  <option value="">Auto</option>
                  <option value="max_tokens">max_tokens</option>
                  <option value="max_completion_tokens">max_completion_tokens</option>
                </select>
              </label>
            </div>
          )}

          <div className="mt-3 rounded-lg border border-line bg-control p-2 text-[11px] text-ink-300">
            <div className="flex items-center justify-between gap-3">
              <span>{authStatus?.message ?? 'Checking auth...'}</span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  authStatus?.ready ? 'bg-success' : 'bg-warning'
                }`}
              />
            </div>
            {authStatus?.maskedCredential && (
              <div className="mt-1 text-faint">{authStatus.maskedCredential}</div>
            )}
          </div>

          {authUrl?.instructions && (
            <div className="mt-2 rounded-lg border border-line bg-control p-2 text-[11px] text-ink-300">
              {authUrl.instructions}
            </div>
          )}
          {message && <div className="mt-2 text-[11px] text-muted">{message}</div>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => saveRuntime('pi-ai')}
              disabled={!!busy || !draft.modelId.trim()}
              className="rounded-lg bg-action px-3 py-2 text-[12px] font-medium text-action-fg hover:opacity-90 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={testConnection}
              disabled={!!busy || !draft.modelId.trim()}
              className="rounded-lg border border-line bg-control px-3 py-2 text-[12px] text-fg hover:bg-control-hover disabled:opacity-50"
            >
              Test connection
            </button>
            <button
              onClick={clearAuth}
              disabled={!!busy}
              className="rounded-lg border border-line bg-panel-strong px-3 py-2 text-[12px] text-muted hover:bg-control-hover disabled:opacity-50"
            >
              Clear credentials
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CompatToggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-[11px] text-muted">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent-aubergine"
      />
    </label>
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
        active ? 'bg-sidebar-active text-white shadow-sm scale-[1.02]' : 'text-muted hover:text-fg scale-100'
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
  providerLabel,
  onRegenerate
}: {
  messages: ChatMessage[]
  streaming: boolean
  mode: AgentMode
  providerLabel: string
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
        <EmptyState mode={mode} providerLabel={providerLabel} />
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

function EmptyState({ mode, providerLabel }: { mode: AgentMode; providerLabel: string }) {
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
        <img src={vibeLogoUrl} alt="Vibe Chat" className="mx-auto mb-6 h-20 w-20" draggable={false} />
        <div className="mb-3 text-[32px] font-semibold tracking-tight text-fg">
          {mode === 'code' ? 'What should we build?' : 'How can I help?'}
        </div>
        <div className="text-sm text-muted">
          {mode === 'code'
            ? providerLabel === 'local'
              ? 'Vibe will write files into a workspace and show a live preview on the right.'
              : providerLabel.startsWith('Ollama/')
                ? `${providerLabel} will write files into a workspace and stream changes back.`
              : `The selected Pi AI model will write files into a workspace and stream changes back.`
            : providerLabel === 'local'
              ? 'Running locally. Your messages never leave your Mac.'
              : providerLabel.startsWith('Ollama/')
                ? `Streaming through ${providerLabel} on this machine.`
              : `Streaming through ${providerLabel}. Provider terms and network access apply.`}
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
            className="anim-fade-up rounded-xl border border-line bg-panel px-4 py-3 text-left transition hover:border-sidebar-active hover:bg-panel-strong active:scale-[0.98]"
          >
            <div className="text-sm font-medium text-fg">{s.title}</div>
            <div className="mt-0.5 text-[12.5px] text-muted">{s.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
