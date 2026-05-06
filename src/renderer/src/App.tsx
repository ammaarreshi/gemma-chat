import { useEffect, useState } from 'react'
import { DEFAULT_MODEL, type RuntimeConfig, type SetupStatus } from '@shared/types'
import Setup from './components/Setup'
import Chat from './components/Chat'

type AppState =
  | { phase: 'boot' }
  | { phase: 'setup'; status: SetupStatus; runtime: RuntimeConfig }
  | { phase: 'ready'; runtime: RuntimeConfig }
  | { phase: 'switching'; runtime: RuntimeConfig; toRuntime: RuntimeConfig; status: SetupStatus }

const RUNTIME_STORAGE_KEY = 'gemma-chat:runtime:v1'
const DEFAULT_RUNTIME: RuntimeConfig = { provider: 'mlx', model: DEFAULT_MODEL }

function loadRuntime(): RuntimeConfig {
  try {
    const raw = localStorage.getItem(RUNTIME_STORAGE_KEY)
    if (!raw) return DEFAULT_RUNTIME
    const parsed = JSON.parse(raw) as RuntimeConfig
    if (parsed.provider === 'lm-studio' && parsed.model && parsed.endpoint) return parsed
    if (parsed.provider === 'mlx' && parsed.model) return parsed
  } catch {
    // ignore
  }
  return DEFAULT_RUNTIME
}

function saveRuntime(runtime: RuntimeConfig): void {
  try {
    localStorage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify(runtime))
  } catch {
    // ignore
  }
}

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'boot' })

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
              saveRuntime(prev.toRuntime)
              return { phase: 'ready', runtime: prev.toRuntime }
            }
            const runtime = prev.phase === 'setup' ? prev.runtime : DEFAULT_RUNTIME
            saveRuntime(runtime)
            return { phase: 'ready', runtime }
          }
          if (status.stage === 'error') {
            // If switch failed, go back to the previous model
            if (prev.phase === 'switching') {
              return { phase: 'ready', runtime: prev.runtime }
            }
          }
          // If we're in switching phase, keep it as switching
          if (prev.phase === 'switching') {
            return { ...prev, status }
          }
          const runtime = prev.phase === 'setup' ? prev.runtime : DEFAULT_RUNTIME
          return { phase: 'setup', status, runtime }
        })
      })

      const runtime = loadRuntime()
      if (runtime.provider === 'lm-studio') {
        setState({
          phase: 'setup',
          status: { stage: 'checking', message: 'Welcome' },
          runtime
        })
        return
      }

      const local = await window.api.listLocalModels()
      const hasDefault = local.some(
        (m) => m === runtime.model || m.startsWith(runtime.model + ':')
      )
      if (hasDefault) {
        const { hasMLX } = await window.api.checkMLX()
        if (hasMLX) {
          setState({
            phase: 'setup',
            status: { stage: 'starting-mlx', message: 'Starting model runtime…' },
            runtime
          })
          window.api.startSetup(runtime)
          return
        }
      }
      setState({
        phase: 'setup',
        status: { stage: 'checking', message: 'Welcome' },
        runtime
      })
    })()
    return () => {
      unsub?.()
      rawUnsub?.()
    }
  }, [])

  function handleSwitchRuntime(newRuntime: RuntimeConfig): void {
    setState((prev) => {
      if (prev.phase !== 'ready') return prev
      if (JSON.stringify(prev.runtime) === JSON.stringify(newRuntime)) return prev
      return {
        phase: 'switching',
        runtime: prev.runtime,
        toRuntime: newRuntime,
        status: { stage: 'downloading-model', message: 'Switching runtime…' }
      }
    })
    window.api.switchModel(newRuntime)
  }

  if (state.phase === 'boot') {
    return <BootSplash />
  }

  if (state.phase === 'setup') {
    return (
      <div key="setup" className="anim-fade-in h-full w-full">
        <Setup
          status={state.status}
          runtime={state.runtime}
          onRuntimeChange={(runtime) =>
            setState((s) => (s.phase === 'setup' ? { ...s, runtime } : s))
          }
          onStart={(runtime) => {
            setState({
              phase: 'setup',
              status: { stage: 'checking', message: 'Checking system…' },
              runtime
            })
            window.api.startSetup(runtime)
          }}
        />
      </div>
    )
  }

  if (state.phase === 'switching') {
    return (
      <div key="switching" className="anim-fade-in h-full w-full">
        <Chat runtime={state.runtime} onSwitchRuntime={handleSwitchRuntime} />
        <SwitchingOverlay status={state.status} />
      </div>
    )
  }

  return (
    <div key="chat" className="anim-fade-scale h-full w-full">
      <Chat runtime={state.runtime} onSwitchRuntime={handleSwitchRuntime} />
    </div>
  )
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
