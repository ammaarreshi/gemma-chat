import { useEffect, useLayoutEffect, useState } from 'react'
import {
  DEFAULT_MODEL,
  DEFAULT_PI_AI_CONFIG,
  type AppProviderConfig,
  type SetupStatus
} from '@shared/types'
import Setup from './components/Setup'
import Chat from './components/Chat'
import { applyTheme, persistTheme, readStoredTheme, type ThemeMode } from './theme'

type AppState =
  | { phase: 'boot' }
  | { phase: 'setup'; status: SetupStatus; model: string; providerConfig: AppProviderConfig }
  | { phase: 'ready'; model: string; providerConfig: AppProviderConfig }
  | {
      phase: 'switching'
      model: string
      toModel: string
      status: SetupStatus
      providerConfig: AppProviderConfig
    }

function fallbackProviderConfig(): AppProviderConfig {
  return {
    selectedProvider: 'local-mlx',
    localModel: DEFAULT_MODEL,
    piAi: { ...DEFAULT_PI_AI_CONFIG }
  }
}

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'boot' })
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme())

  useLayoutEffect(() => {
    applyTheme(theme)
    persistTheme(theme)
  }, [theme])

  useEffect(() => {
    // Forward raw model output to devtools console for debugging.
    const rawUnsub = window.api.onRawChunk((ev) => {
      // eslint-disable-next-line no-console
      console.log('[model]', ev.chunk)
    })
    let unsub: (() => void) | undefined
    ;(async () => {
      unsub = window.api.onSetupStatus((status) => {
        setState((prev) => {
          if (status.stage === 'ready') {
            // If we were switching, the new model is now ready
            if (prev.phase === 'switching') {
              return {
                phase: 'ready',
                model: prev.toModel,
                providerConfig: { ...prev.providerConfig, localModel: prev.toModel }
              }
            }
            return {
              phase: 'ready',
              model: prev.phase === 'setup' ? prev.model : DEFAULT_MODEL,
              providerConfig: prev.phase === 'setup' ? prev.providerConfig : fallbackProviderConfig()
            }
          }
          if (status.stage === 'error') {
            // If switch failed, go back to the previous model
            if (prev.phase === 'switching') {
              return {
                phase: 'ready',
                model: prev.model,
                providerConfig: prev.providerConfig
              }
            }
          }
          // If we're in switching phase, keep it as switching
          if (prev.phase === 'switching') {
            return { ...prev, status }
          }
          const model = prev.phase === 'setup' ? prev.model : DEFAULT_MODEL
          const providerConfig =
            prev.phase === 'setup' ? prev.providerConfig : fallbackProviderConfig()
          return { phase: 'setup', status, model, providerConfig }
        })
      })

      const providerConfig = await window.api.getProviderConfig()
      if (providerConfig.selectedProvider === 'pi-ai') {
        setState({
          phase: 'ready',
          model: providerConfig.localModel,
          providerConfig
        })
        return
      }

      const model = providerConfig.localModel || DEFAULT_MODEL
      const local = await window.api.listLocalModels()
      const hasDefault = local.some(
        (m) => m === model || m.startsWith(model + ':')
      )
      if (hasDefault) {
        const { hasMLX } = await window.api.checkMLX()
        if (hasMLX) {
          setState({
            phase: 'setup',
            status: { stage: 'starting-mlx', message: 'Starting model runtime…' },
            model,
            providerConfig
          })
          window.api.startSetup(model)
          return
        }
      }
      setState({
        phase: 'setup',
        status: { stage: 'checking', message: 'Welcome' },
        model,
        providerConfig
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
        status: { stage: 'downloading-model', message: 'Switching model…' },
        providerConfig: { ...prev.providerConfig, selectedProvider: 'local-mlx', localModel: newModel }
      }
    })
    window.api.switchModel(newModel)
  }

  async function handleProviderConfigChange(config: AppProviderConfig): Promise<void> {
    const saved = await window.api.saveProviderConfig(config)
    setState((prev) => {
      if (prev.phase === 'ready') {
        return { ...prev, model: saved.localModel, providerConfig: saved }
      }
      if (prev.phase === 'setup') {
        return { ...prev, model: saved.localModel, providerConfig: saved }
      }
      if (prev.phase === 'switching') {
        return { ...prev, providerConfig: saved }
      }
      return prev
    })
  }

  async function handleUsePiAi(): Promise<void> {
    const current = state.phase === 'setup' ? state.providerConfig : fallbackProviderConfig()
    const saved = await window.api.saveProviderConfig({
      ...current,
      selectedProvider: 'pi-ai'
    })
    setState({ phase: 'ready', model: saved.localModel, providerConfig: saved })
  }

  if (state.phase === 'boot') {
    return <BootSplash />
  }

  if (state.phase === 'setup') {
    return (
      <div key="setup" className="anim-fade-in h-full w-full">
        <Setup
          status={state.status}
          model={state.model}
          onModelChange={(m) =>
            setState((s) =>
              s.phase === 'setup'
                ? {
                    ...s,
                    model: m,
                    providerConfig: { ...s.providerConfig, localModel: m }
                  }
                : s
            )
          }
          onStart={(model) => {
            setState({
              phase: 'setup',
              status: { stage: 'checking', message: 'Checking system…' },
              model,
              providerConfig: {
                ...state.providerConfig,
                selectedProvider: 'local-mlx',
                localModel: model
              }
            })
            window.api.startSetup(model)
          }}
          onUsePiAi={handleUsePiAi}
        />
      </div>
    )
  }

  if (state.phase === 'switching') {
    return (
      <div key="switching" className="anim-fade-in h-full w-full">
        <Chat
          model={state.model}
          providerConfig={state.providerConfig}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          onProviderConfigChange={handleProviderConfigChange}
          onSwitchModel={handleSwitchModel}
        />
        <SwitchingOverlay status={state.status} />
      </div>
    )
  }

  return (
    <div key="chat" className="anim-fade-scale h-full w-full">
      <Chat
        model={state.model}
        providerConfig={state.providerConfig}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        onProviderConfigChange={handleProviderConfigChange}
        onSwitchModel={handleSwitchModel}
      />
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
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 backdrop-blur-sm">
      <div className="anim-fade-up flex flex-col items-center gap-4 rounded-2xl border border-line bg-panel px-10 py-8 shadow-2xl shadow-shadow">
        <div className="shimmer h-1 w-32 rounded-full" />
        <p className="text-sm text-ink-200">{status.message}</p>
        {status.progress != null && status.progress > 0 && (
          <div className="w-48">
            <div className="h-1 w-full rounded-full bg-control">
              <div
                className="h-full rounded-full bg-accent-green transition-all duration-500"
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
