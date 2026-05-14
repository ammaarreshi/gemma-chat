import { useEffect, useRef, useState } from 'react'
import { DEFAULT_MODEL, makeModelConfig, type ModelConfig, type SetupStatus } from '@shared/types'
import Setup from './components/Setup'
import Chat from './components/Chat'

type AppState =
  | { phase: 'boot' }
  | { phase: 'setup'; status: SetupStatus; config: ModelConfig }
  | { phase: 'ready'; config: ModelConfig }
  | { phase: 'switching'; config: ModelConfig; toConfig: ModelConfig; status: SetupStatus }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'boot' })
  const switchingRef = useRef(false)
  const pendingConfigRef = useRef<ModelConfig | null>(null)

  // Fire the IPC only after the state has committed to 'switching',
  // keeping setState updaters pure (React StrictMode may double-invoke them).
  useEffect(() => {
    if (state.phase === 'switching' && pendingConfigRef.current) {
      window.api.switchModel(pendingConfigRef.current)
      pendingConfigRef.current = null
    }
    if (state.phase !== 'switching') {
      switchingRef.current = false
    }
  }, [state.phase])

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
          const defaultConfig = makeModelConfig(DEFAULT_MODEL)
          if (status.stage === 'ready') {
            if (prev.phase === 'switching') {
              return { phase: 'ready', config: prev.toConfig }
            }
            return { phase: 'ready', config: prev.phase === 'setup' ? prev.config : defaultConfig }
          }
          if (status.stage === 'error') {
            if (prev.phase === 'switching') {
              return { phase: 'ready', config: prev.config }
            }
          }
          if (prev.phase === 'switching') {
            return { ...prev, status }
          }
          const config = prev.phase === 'setup' ? prev.config : defaultConfig
          return { phase: 'setup', status, config }
        })
      })

      const local = await window.api.listLocalModels()
      const hasDefault = local.some(
        (m) => m === DEFAULT_MODEL || m.startsWith(DEFAULT_MODEL + ':')
      )
      if (hasDefault) {
        const { hasMLX } = await window.api.checkMLX()
        if (hasMLX) {
          const defaultConfig = makeModelConfig(DEFAULT_MODEL)
          setState({
            phase: 'setup',
            status: { stage: 'starting-mlx', message: 'Starting model runtime…' },
            config: defaultConfig
          })
          window.api.startSetup(defaultConfig)
          return
        }
      }
      setState({
        phase: 'setup',
        status: { stage: 'checking', message: 'Welcome' },
        config: makeModelConfig(DEFAULT_MODEL)
      })
    })()
    return () => {
      unsub?.()
      rawUnsub?.()
    }
  }, [])

  function handleSwitchModel(config: ModelConfig): void {
    if (switchingRef.current) return
    if (state.phase !== 'ready') return
    if (state.config.model === config.model && state.config.draftModel === config.draftModel && state.config.numDraftTokens === config.numDraftTokens) return

    switchingRef.current = true
    pendingConfigRef.current = config
    setState({
      phase: 'switching',
      config: state.config,
      toConfig: config,
      status: { stage: 'downloading-model', message: 'Switching model…' }
    })
  }

  if (state.phase === 'boot') {
    return <BootSplash />
  }

  if (state.phase === 'setup') {
    return (
      <div key="setup" className="anim-fade-in h-full w-full">
        <Setup
          status={state.status}
          config={state.config}
          onConfigChange={(config) =>
            setState((s) => (s.phase === 'setup' ? { ...s, config } : s))
          }
          onStart={(config) => {
            setState({
              phase: 'setup',
              status: { stage: 'checking', message: 'Checking system…' },
              config
            })
            window.api.startSetup(config)
          }}
        />
      </div>
    )
  }

  if (state.phase === 'switching') {
    return (
      <div key="switching" className="anim-fade-in h-full w-full">
        <Chat config={state.config} onSwitchModel={handleSwitchModel} />
        <SwitchingOverlay status={state.status} />
      </div>
    )
  }

  return (
    <div key="chat" className="anim-fade-scale h-full w-full">
      <Chat config={state.config} onSwitchModel={handleSwitchModel} />
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
