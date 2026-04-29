import { useEffect, useState } from 'react'
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  OLLAMA_MODEL_PREFIX,
  runtimeModelName,
  type ModelInfo,
  type SetupStatus
} from '@shared/types'
import Setup from './components/Setup'
import Chat from './components/Chat'

type AppState =
  | { phase: 'boot' }
  | { phase: 'setup'; status: SetupStatus; model: string }
  | { phase: 'ready'; model: string }
  | { phase: 'switching'; model: string; toModel: string; status: SetupStatus }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'boot' })
  const [models, setModels] = useState<ModelInfo[]>(AVAILABLE_MODELS)

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
            return { phase: 'ready', model: prev.phase === 'setup' ? prev.model : DEFAULT_MODEL }
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
          const model = prev.phase === 'setup' ? prev.model : DEFAULT_MODEL
          return { phase: 'setup', status, model }
        })
      })

      const local = await window.api.listLocalModels()
      setModels(mergeLocalModels(local))
      const hasDefault = local.some(
        (m) => m === DEFAULT_MODEL || m.startsWith(DEFAULT_MODEL + ':')
      )
      if (hasDefault) {
        const { hasMLX } = await window.api.checkMLX()
        if (hasMLX) {
          setState({
            phase: 'setup',
            status: { stage: 'starting-mlx', message: 'Starting model runtime…' },
            model: DEFAULT_MODEL
          })
          window.api.startSetup(DEFAULT_MODEL)
          return
        }
      }
      setState({
        phase: 'setup',
        status: { stage: 'checking', message: 'Welcome' },
        model: DEFAULT_MODEL
      })
    })()
    return () => {
      unsub?.()
      rawUnsub?.()
    }
  }, [])

  function handleSwitchModel(newModel: string): void {
    setState((prev) => {
      if (prev.phase !== 'ready') return prev
      if (prev.model === newModel) return prev
      return {
        phase: 'switching',
        model: prev.model,
        toModel: newModel,
        status: { stage: 'downloading-model', message: 'Switching model…' }
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
          onModelChange={(m) =>
            setState((s) => (s.phase === 'setup' ? { ...s, model: m } : s))
          }
          onStart={(model) => {
            setState({
              phase: 'setup',
              status: { stage: 'checking', message: 'Checking system…' },
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

function mergeLocalModels(local: string[]): ModelInfo[] {
  const seen = new Set(AVAILABLE_MODELS.map((m) => m.name))
  const extra = local
    .filter((model) => model.startsWith(OLLAMA_MODEL_PREFIX) && !seen.has(model))
    .map((model): ModelInfo => {
      const name = runtimeModelName(model)
      return {
        provider: 'ollama',
        name: model,
        label: name,
        size: 'Ollama',
        sizeBytes: 0,
        description: `Local Ollama model. Requires Ollama running with ${name} installed.`
      }
    })

  return [...AVAILABLE_MODELS, ...extra]
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
