import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AVAILABLE_MODELS,
  type AgentMode,
  type AppProviderConfig,
  type ChatMessage,
  type PiAiAuthEvent,
  type PiAiAuthMode,
  type PiAiAuthStatus,
  type PiAiModelSummary,
  type PiAiProviderConfig,
  type PiAiProviderInfo,
  type ToolCall,
  type StreamChunk
} from '@shared/types'
import gemmaLogoUrl from '../assets/gemma-logo.png'
import Composer from './Composer'
import Message from './Message'
import Sidebar from './Sidebar'
import Canvas from './Canvas'

interface Props {
  model: string
  providerConfig: AppProviderConfig
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

export default function Chat({
  model,
  providerConfig,
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
              : { id: 'local-mlx', model },
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
        providerLabel={providerConfig.selectedProvider === 'pi-ai' ? 'Pi AI' : 'Local'}
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
            onToggleMode={toggleMode}
            onToggleCanvas={toggleCanvas}
            onSwitchModel={onSwitchModel}
            onProviderConfigChange={onProviderConfigChange}
          />
          <MessageList
            messages={activeConversation.messages}
            streaming={streaming}
            mode={activeConversation.mode}
            providerLabel={
              providerConfig.selectedProvider === 'pi-ai'
                ? `${providerConfig.piAi.providerId}/${providerConfig.piAi.modelId}`
                : 'local'
            }
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
  providerConfig,
  mode,
  canvasOpen,
  onToggleMode,
  onToggleCanvas,
  onSwitchModel,
  onProviderConfigChange
}: {
  model: string
  providerConfig: AppProviderConfig
  mode: AgentMode
  canvasOpen: boolean
  onToggleMode: () => void
  onToggleCanvas: () => void
  onSwitchModel: (model: string) => void
  onProviderConfigChange: (config: AppProviderConfig) => Promise<void>
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
      : (AVAILABLE_MODELS.find((m) => m.name === model)?.label ?? model)

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
  const [authStatus, setAuthStatus] = useState<PiAiAuthStatus | null>(null)
  const [authUrl, setAuthUrl] = useState<{ url: string; instructions?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const apiKeyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(providerConfig.piAi)
  }, [providerConfig.piAi])

  useEffect(() => {
    window.api.listProviders().then((res) => setPiProviders(res.piAiProviders)).catch(() => {
      setPiProviders([])
    })
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
    <div className="anim-fade-scale absolute right-0 top-full z-50 mt-1 w-[420px] rounded-xl border border-white/10 bg-[#1a1a1a] p-2 shadow-2xl backdrop-blur-xl">
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.04] p-1 text-[12px]">
        <button
          onClick={() => saveRuntime('local-mlx')}
          className={`rounded-md px-2 py-1.5 font-medium transition ${
            providerConfig.selectedProvider === 'local-mlx'
              ? 'bg-white/10 text-white'
              : 'text-ink-300 hover:bg-white/[0.05] hover:text-white'
          }`}
        >
          Local Gemma / MLX
        </button>
        <button
          onClick={() => saveRuntime('pi-ai')}
          className={`rounded-md px-2 py-1.5 font-medium transition ${
            providerConfig.selectedProvider === 'pi-ai'
              ? 'bg-white/10 text-white'
              : 'text-ink-300 hover:bg-white/[0.05] hover:text-white'
          }`}
        >
          Pi AI Provider
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <div className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
          Local models
        </div>
        <div className="space-y-1">
          {AVAILABLE_MODELS.map((m) => (
            <button
              key={m.name}
              onClick={() => {
                if (m.name !== model) onSwitchModel(m.name)
              }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-all duration-150 ${
                providerConfig.selectedProvider === 'local-mlx' && m.name === model
                  ? 'bg-white/[0.07] text-white'
                  : 'text-ink-200 hover:bg-white/[0.04]'
              }`}
            >
              <div>
                <div className="text-[12.5px] font-medium">{m.label}</div>
                <div className="mt-0.5 text-[11px] text-ink-400">{m.size}</div>
              </div>
              {m.recommended && (
                <span className="rounded-full bg-white/10 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-ink-200">
                  rec
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-white/[0.07] pt-3">
          <div className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
            Pi AI
          </div>
          <label className="block text-[11px] text-ink-400">
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
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[12px] text-white outline-none focus:border-white/25"
            >
              {piProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          {draft.providerId === 'openai' && (
            <p className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2 text-[11px] text-ink-300">
              Uses OpenAI API key.
            </p>
          )}
          {draft.providerId === 'openai-codex' && (
            <p className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2 text-[11px] text-ink-300">
              Uses ChatGPT/Codex subscription OAuth, not OpenAI API key billing.
            </p>
          )}

          <label className="mt-3 block text-[11px] text-ink-400">
            Catalog model
            <select
              value={models.some((m) => m.id === draft.modelId) ? draft.modelId : ''}
              onChange={(e) => updateDraft({ modelId: e.target.value })}
              disabled={models.length === 0}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[12px] text-white outline-none focus:border-white/25 disabled:opacity-50"
            >
              <option value="">Custom model id</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-2 block text-[11px] text-ink-400">
            Model id
            <input
              value={draft.modelId}
              onChange={(e) => updateDraft({ modelId: e.target.value })}
              placeholder={models[0]?.id ?? 'model-id'}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[12px] text-white outline-none placeholder:text-ink-500 focus:border-white/25"
            />
          </label>

          <label className="mt-2 block text-[11px] text-ink-400">
            Auth method
            <select
              value={draft.authMode}
              onChange={(e) => updateDraft({ authMode: e.target.value as PiAiAuthMode })}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[12px] text-white outline-none focus:border-white/25"
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
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[12px] text-white outline-none placeholder:text-ink-500 focus:border-white/25"
              />
              <button
                onClick={saveApiKey}
                disabled={!!busy}
                className="rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[12px] text-white hover:bg-white/[0.1] disabled:opacity-50"
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
                className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-white hover:bg-white/[0.1] disabled:opacity-50"
              >
                Sign in
              </button>
              {authUrl && (
                <button
                  onClick={() => window.api.openProviderAuthUrl(authUrl.url)}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-ink-100 hover:bg-white/[0.07]"
                >
                  Open browser
                </button>
              )}
              {authStatus?.hasStoredCredential && (
                <button
                  onClick={refreshAuth}
                  disabled={!!busy}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-ink-100 hover:bg-white/[0.07] disabled:opacity-50"
                >
                  Refresh
                </button>
              )}
            </div>
          )}

          <label className="mt-3 block text-[11px] text-ink-400">
            Base URL
            <input
              value={draft.baseUrl ?? ''}
              onChange={(e) => updateDraft({ baseUrl: e.target.value || undefined })}
              placeholder="https://api.example.com/v1"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-[12px] text-white outline-none placeholder:text-ink-500 focus:border-white/25"
            />
          </label>

          {showCompat && (
            <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
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
              <label className="mt-1 block text-[11px] text-ink-400">
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
                  className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-white"
                >
                  <option value="">Auto</option>
                  <option value="max_tokens">max_tokens</option>
                  <option value="max_completion_tokens">max_completion_tokens</option>
                </select>
              </label>
            </div>
          )}

          <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[11px] text-ink-300">
            <div className="flex items-center justify-between gap-3">
              <span>{authStatus?.message ?? 'Checking auth...'}</span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  authStatus?.ready ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
            </div>
            {authStatus?.maskedCredential && (
              <div className="mt-1 text-ink-500">{authStatus.maskedCredential}</div>
            )}
          </div>

          {authUrl?.instructions && (
            <div className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2 text-[11px] text-ink-300">
              {authUrl.instructions}
            </div>
          )}
          {message && <div className="mt-2 text-[11px] text-ink-400">{message}</div>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => saveRuntime('pi-ai')}
              disabled={!!busy || !draft.modelId.trim()}
              className="rounded-lg bg-white px-3 py-2 text-[12px] font-medium text-ink-900 hover:bg-white/90 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={testConnection}
              disabled={!!busy || !draft.modelId.trim()}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] text-white hover:bg-white/[0.08] disabled:opacity-50"
            >
              Test connection
            </button>
            <button
              onClick={clearAuth}
              disabled={!!busy}
              className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-ink-300 hover:bg-white/[0.06] disabled:opacity-50"
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
    <label className="flex items-center justify-between gap-3 py-1 text-[11px] text-ink-400">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-white"
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
        <img src={gemmaLogoUrl} alt="Gemma" className="mx-auto mb-6 h-20 w-20" draggable={false} />
        <div className="mb-3 text-[32px] font-semibold tracking-tight text-white">
          {mode === 'code' ? 'What should we build?' : 'How can I help?'}
        </div>
        <div className="text-sm text-ink-400">
          {mode === 'code'
            ? providerLabel === 'local'
              ? 'Gemma will write files into a workspace and show a live preview on the right.'
              : `The selected Pi AI model will write files into a workspace and stream changes back.`
            : providerLabel === 'local'
              ? 'Running locally. Your messages never leave your Mac.'
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
