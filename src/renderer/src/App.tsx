import { useEffect, useRef, useState } from 'react'
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_MODEL_PREFIX,
  modelProvider,
  runtimeModelName,
  type ModelInfo,
  type SetupStatus
} from '@shared/types'
import Setup from './components/Setup'
import Chat from './components/Chat'

type RuntimeStatus = { hasMLX: boolean; hasOllama: boolean }

const OLLAMA_URL_STORAGE_KEY = 'gemma-chat:ollama-base-url:v1'

type AppState =
  | { phase: 'boot' }
  | { phase: 'setup'; status: SetupStatus; model: string }
  | { phase: 'ready'; model: string }
  | { phase: 'switching'; model: string; toModel: string; status: SetupStatus }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'boot' })
  const [models, setModels] = useState<ModelInfo[]>(AVAILABLE_MODELS)
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(() => loadOllamaBaseUrl())
  const setupModelRef = useRef(DEFAULT_OLLAMA_MODEL)

  useEffect(() => {
    // Forward raw Gemma output to devtools console for debugging
    const rawUnsub = window.api.onRawChunk((ev) => {
      // eslint-disable-next-line no-console
      console.log('[gemma]', ev.chunk)
    })
    let unsub: (() => void) | undefined
    ;(async () => {
      unsub = window.api.onSetupStatus((status) => {
        setState((prev) => {
          if (status.stage === 'ready') {
            // If we were switching, the new model is now ready
            if (prev.phase === 'switching') {
              return { phase: 'ready', model: prev.toModel }
            }
            return {
              phase: 'ready',
              model: prev.phase === 'setup' ? prev.model : setupModelRef.current
            }
          }
          if (status.stage === 'error') {
            // If switch failed, go back to the previous model
            if (prev.phase === 'switching') {
              return { phase: 'ready', model: prev.model }
            }
          }
          // If we're in switching phase, keep it as switching
          if (prev.phase === 'switching') {
            return { ...prev, status }
          }
          const model = prev.phase === 'setup' ? prev.model : setupModelRef.current
          return { phase: 'setup', status, model }
        })
      })

      await window.api.setOllamaBaseUrl(ollamaBaseUrl)
      const { local, runtimes } = await refreshRuntimeModels()
      const mergedModels = mergeLocalModels(local)
      const initialModel = pickInitialModel(local, runtimes)
      setupModelRef.current = initialModel
      setModels(mergedModels)

      if (canAutoStart(initialModel, local, runtimes)) {
        setState({
          phase: 'setup',
          status: {
            stage: modelProvider(initialModel) === 'ollama' ? 'connecting-ollama' : 'starting-mlx',
            message: 'Starting model runtime...'
          },
          model: initialModel
        })
        window.api.startSetup(initialModel)
        return
      }

      setState({
        phase: 'setup',
        status: { stage: 'checking', message: 'Welcome' },
        model: initialModel
      })
    })()
    return () => {
      unsub?.()
      rawUnsub?.()
    }
  }, [])

  async function refreshRuntimeModels(): Promise<{ local: string[]; runtimes: RuntimeStatus }> {
    const [local, runtimes] = await Promise.all([
      window.api.listLocalModels(),
      window.api.checkMLX()
    ])
    setModels(mergeLocalModels(local))
    return { local, runtimes }
  }

  async function handleOllamaBaseUrlChange(value: string): Promise<void> {
    setOllamaBaseUrl(value)
    saveOllamaBaseUrl(value)
    await window.api.setOllamaBaseUrl(value)
    await refreshRuntimeModels()
  }

  function handleSwitchModel(newModel: string): void {
    setState((prev) => {
      if (prev.phase !== 'ready') return prev
      if (prev.model === newModel) return prev
      return {
        phase: 'switching',
        model: prev.model,
        toModel: newModel,
        status: { stage: 'downloading-model', message: 'Switching model...' }
      }
    })
    window.api.switchModel(newModel)
  }

  if (state.phase === 'boot') {
    return <BootSplash />
  }

  if (state.phase === 'setup') {
    return (
      <div key="setup" className="anim-fade-in h-full w-full">
        <Setup
          models={models}
          status={state.status}
          model={state.model}
          ollamaBaseUrl={ollamaBaseUrl}
          onModelChange={(m) =>
            setState((s) => (s.phase === 'setup' ? { ...s, model: m } : s))
          }
          onOllamaBaseUrlChange={handleOllamaBaseUrlChange}
          onStart={(model) => {
            setupModelRef.current = model
            setState({
              phase: 'setup',
              status: { stage: 'checking', message: 'Checking system...' },
              model
            })
            window.api.startSetup(model)
          }}
        />
      </div>
    )
  }

  if (state.phase === 'switching') {
    return (
      <div key="switching" className="anim-fade-in h-full w-full">
        <Chat model={state.model} models={models} onSwitchModel={handleSwitchModel} />
        <SwitchingOverlay status={state.status} />
      </div>
    )
  }

  return (
    <div key="chat" className="anim-fade-scale h-full w-full">
      <Chat model={state.model} models={models} onSwitchModel={handleSwitchModel} />
    </div>
  )
}

function loadOllamaBaseUrl(): string {
  try {
    return localStorage.getItem(OLLAMA_URL_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveOllamaBaseUrl(value: string): void {
  try {
    const trimmed = value.trim()
    if (trimmed) {
      localStorage.setItem(OLLAMA_URL_STORAGE_KEY, trimmed)
    } else {
      localStorage.removeItem(OLLAMA_URL_STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}

function mergeLocalModels(local: string[]): ModelInfo[] {
  const installedOllama = local.filter((model) => model.startsWith(OLLAMA_MODEL_PREFIX))
  const installed = new Set(installedOllama)
  const known = new Map(AVAILABLE_MODELS.map((model) => [model.name, model]))

  const installedOllamaModels = installedOllama.map((model): ModelInfo => {
    const runtimeName = runtimeModelName(model)
    const base = known.get(model)
    return {
      provider: 'ollama',
      name: model,
      label: base?.label ?? runtimeName,
      size: 'Installed',
      sizeBytes: base?.sizeBytes ?? 0,
      description: `${runtimeName} is installed in Ollama and ready to use.`,
      recommended: model === DEFAULT_OLLAMA_MODEL || base?.recommended
    }
  })

  const mlxModels = AVAILABLE_MODELS.filter((model) => model.provider === 'mlx')
  const ollamaSuggestions = AVAILABLE_MODELS.filter(
    (model) => model.provider === 'ollama' && !installed.has(model.name)
  )

  return [...installedOllamaModels, ...mlxModels, ...ollamaSuggestions]
}

function pickInitialModel(local: string[], runtimes: RuntimeStatus): string {
  if (runtimes.hasOllama) {
    if (local.includes(DEFAULT_OLLAMA_MODEL)) return DEFAULT_OLLAMA_MODEL
    const firstOllama = local.find((model) => model.startsWith(OLLAMA_MODEL_PREFIX))
    if (firstOllama) return firstOllama
  }
  if (runtimes.hasMLX && local.some((model) => model === DEFAULT_MODEL)) return DEFAULT_MODEL
  return runtimes.hasOllama ? DEFAULT_OLLAMA_MODEL : DEFAULT_MODEL
}

function canAutoStart(model: string, local: string[], runtimes: RuntimeStatus): boolean {
  if (modelProvider(model) === 'ollama') {
    return runtimes.hasOllama && local.includes(model)
  }
  return runtimes.hasMLX && local.some((localModel) => localModel === model)
}

function BootSplash() {
  return (
    <div className="drag flex h-full w-full items-center justify-center">
      <div className="shimmer h-1 w-40 rounded-full" />
    </div>
  )
}

function SwitchingOverlay({ status }: { status: SetupStatus }) {
  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="anim-fade-up flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-ink-950 px-10 py-8 shadow-2xl">
        <div className="shimmer h-1 w-32 rounded-full" />
        <p className="text-sm text-ink-200">{status.message}</p>
        {status.progress != null && status.progress > 0 && (
          <div className="w-48">
            <div className="h-1 w-full rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white/60 transition-all duration-500"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-center text-[10px] text-ink-400">
              {Math.round(status.progress * 100)}%
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
