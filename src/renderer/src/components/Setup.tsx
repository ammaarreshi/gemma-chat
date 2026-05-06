import { useEffect, useState } from 'react'
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  resolveLMStudioModel,
  type RuntimeConfig,
  type SetupStatus
} from '@shared/types'
import gemmaLogoUrl from '../assets/gemma-logo.png'

interface Props {
  status: SetupStatus
  runtime: RuntimeConfig
  onRuntimeChange: (runtime: RuntimeConfig) => void
  onStart: (runtime: RuntimeConfig) => void
}

function formatBytes(n?: number): string {
  if (!n) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export default function Setup({ status, runtime, onRuntimeChange, onStart }: Props) {
  const isWorking =
    status.stage === 'checking' ||
    status.stage === 'installing-mlx' ||
    status.stage === 'starting-mlx' ||
    status.stage === 'downloading-model' ||
    status.stage === 'connecting-lm-studio'

  if (status.stage === 'checking' && status.message === 'Welcome') {
    return <WelcomeScreen runtime={runtime} onRuntimeChange={onRuntimeChange} onStart={onStart} />
  }

  return (
    <div className="drag flex h-full w-full flex-col">
      <div className="h-9" />
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-md">
          <div className="mb-8 text-center">
            <GemmaLogo className="mx-auto mb-5 h-20 w-20" />
            <h1 className="text-[22px] font-semibold tracking-tight">Setting things up</h1>
            <p className="mt-1.5 text-sm text-ink-400">
              Everything runs locally. Nothing leaves your Mac.
            </p>
          </div>

          <StageList status={status} />

          {isWorking && status.progress != null && (
            <div className="mt-6">
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-white/70 transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(2, Math.round((status.progress ?? 0) * 100))}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] tabular-nums text-ink-400">
                <span>{Math.round((status.progress ?? 0) * 100)}%</span>
                {status.bytesDone != null && status.bytesTotal != null && (
                  <span>
                    {formatBytes(status.bytesDone)} / {formatBytes(status.bytesTotal)}
                  </span>
                )}
              </div>
            </div>
          )}

          {status.stage === 'error' && (
            <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <div className="font-medium">Something went wrong</div>
              <div className="mt-1 text-red-300/80">{status.error}</div>
              <button
                onClick={() => onStart(runtime)}
                className="mt-3 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WelcomeScreen({
  runtime,
  onRuntimeChange,
  onStart
}: {
  runtime: RuntimeConfig
  onRuntimeChange: (runtime: RuntimeConfig) => void
  onStart: (runtime: RuntimeConfig) => void
}) {
  const [lmStudioModels, setLmStudioModels] = useState<string[]>([])
  const [modelListState, setModelListState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [modelListError, setModelListError] = useState('')
  const selected =
    AVAILABLE_MODELS.find((m) => m.name === runtime.model) ??
    AVAILABLE_MODELS.find((m) => m.name === DEFAULT_MODEL) ??
    AVAILABLE_MODELS[0]
  const lmStudioEndpoint = runtime.provider === 'lm-studio' ? (runtime.endpoint ?? '') : 'http://127.0.0.1:1234'
  const lmStudioModel = runtime.provider === 'lm-studio' ? runtime.model : ''
  const selectedAppModel = runtime.appModel ?? selected.name
  const selectedResolvedModel = resolveLMStudioModel(selectedAppModel, lmStudioModels)
  const selectedLMStudioModel =
    runtime.provider === 'lm-studio' && runtime.appModel
      ? selectedResolvedModel
      : lmStudioModel.trim()
  const startLMStudioModel = selectedLMStudioModel ?? ''
  const canStartLMStudio = runtime.provider !== 'lm-studio' || !!selectedLMStudioModel

  useEffect(() => {
    if (runtime.provider !== 'lm-studio' || !lmStudioEndpoint.trim()) {
      setLmStudioModels([])
      setModelListState('idle')
      setModelListError('')
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(() => {
      setModelListState('loading')
      setModelListError('')
      window.api
        .listOpenAIModels(lmStudioEndpoint)
        .then((models) => {
          if (cancelled) return
          setLmStudioModels(models)
          setModelListState('idle')
          if (!lmStudioModel && models[0]) {
            const defaultResolved = resolveLMStudioModel(DEFAULT_MODEL, models)
            onRuntimeChange({
              provider: 'lm-studio',
              endpoint: lmStudioEndpoint,
              model: defaultResolved ?? models[0],
              appModel: defaultResolved ? DEFAULT_MODEL : undefined
            })
          }
        })
        .catch((e: Error) => {
          if (cancelled) return
          setLmStudioModels([])
          setModelListState('error')
          setModelListError(e.message)
        })
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [runtime.provider, lmStudioEndpoint, lmStudioModel, onRuntimeChange])

  return (
    <div className="drag flex h-full w-full flex-col">
      <div className="h-9" />
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-md">
          <div className="anim-fade-up mb-8 text-center">
            <GemmaLogo className="mx-auto mb-5 h-24 w-24" />
            <h1 className="text-[26px] font-semibold tracking-tight">Welcome to Gemma Chat</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-400">
              A local AI assistant, powered by Google's Gemma 4.
              <br />
              Runs 100% on your Mac. No account, no cloud.
            </p>
          </div>

          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-400">
            Pick a runtime
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-white/[0.03] p-1">
            <button
              onClick={() => onRuntimeChange({ provider: 'mlx', model: selected.name })}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                runtime.provider === 'mlx' ? 'bg-white/[0.12] text-white' : 'text-ink-400 hover:text-white'
              }`}
            >
              Managed MLX
            </button>
            <button
              onClick={() =>
                onRuntimeChange({
                  provider: 'lm-studio',
                  endpoint: lmStudioEndpoint,
                  model: lmStudioModel
                })
              }
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                runtime.provider === 'lm-studio' ? 'bg-white/[0.12] text-white' : 'text-ink-400 hover:text-white'
              }`}
            >
              LM Studio
            </button>
          </div>
          {runtime.provider === 'mlx' ? (
            <div className="anim-stagger space-y-2">
              {AVAILABLE_MODELS.map((m) => (
              <button
                key={m.name}
                onClick={() => onRuntimeChange({ provider: 'mlx', model: m.name })}
                className={`anim-fade-up group relative w-full rounded-xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                  runtime.model === m.name
                    ? 'border-white/25 bg-white/[0.06]'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.label}</span>
                    {m.recommended && (
                      <span className="rounded-full bg-white/10 px-2 py-[1px] text-[10px] font-medium uppercase tracking-wider text-ink-100">
                        Recommended
                      </span>
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-ink-400">{m.size}</span>
                </div>
                <div className="mt-1 text-[12.5px] leading-snug text-ink-400">
                  {m.description}
                </div>
              </button>
              ))}
            </div>
          ) : (
            <div className="anim-fade-up space-y-3 rounded-xl border border-white/10 bg-white/[0.025] p-4">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-400">
                  Server URL
                </span>
                <input
                  value={lmStudioEndpoint}
                  onChange={(e) =>
                    onRuntimeChange({
                      provider: 'lm-studio',
                      endpoint: e.target.value,
                      model: lmStudioModel
                    })
                  }
                  placeholder="http://127.0.0.1:1234"
                  className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-ink-500 focus:border-white/25"
                />
              </label>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
                    Pick a Gemma model
                  </span>
                  {modelListState === 'loading' && (
                    <span className="text-[10px] text-ink-500">Refreshing</span>
                  )}
                </div>
                <div className="space-y-2">
                  {AVAILABLE_MODELS.map((m) => {
                    const resolved = resolveLMStudioModel(m.name, lmStudioModels)
                    const active = runtime.appModel === m.name
                    return (
                    <button
                      key={m.name}
                      onClick={() =>
                        onRuntimeChange({
                          provider: 'lm-studio',
                          endpoint: lmStudioEndpoint,
                          model: resolved ?? m.lmStudioName,
                          appModel: m.name
                        })
                      }
                      className={`w-full rounded-xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                        active
                          ? 'border-white/25 bg-white/[0.08] text-white'
                          : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{m.label}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-[1px] text-[10px] font-medium uppercase tracking-wider ${
                            resolved ? 'bg-emerald-400/12 text-emerald-300' : 'bg-white/8 text-ink-400'
                          }`}
                        >
                          {resolved ? 'Loaded' : 'Not loaded'}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[12px] text-ink-400">
                        {resolved ?? m.lmStudioName}
                      </div>
                    </button>
                    )
                  })}
                </div>
                {modelListError && (
                  <div className="mt-1.5 line-clamp-2 text-[10.5px] text-red-300/80">
                    {modelListError}
                  </div>
                )}
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-400">
                  Custom model ID
                </span>
                <input
                  value={lmStudioModel}
                  onChange={(e) =>
                    onRuntimeChange({
                      provider: 'lm-studio',
                      endpoint: lmStudioEndpoint,
                      model: e.target.value,
                      appModel: undefined
                    })
                  }
                  placeholder="Loaded model id from LM Studio"
                  className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none transition placeholder:text-ink-500 focus:border-white/25"
                />
              </label>
              <p className="text-[11px] leading-relaxed text-ink-400">
                Start the LM Studio local server, load a Gemma model, then enter its OpenAI-compatible URL and model id.
              </p>
            </div>
          )}

          <button
            onClick={() =>
              onStart(
                runtime.provider === 'mlx'
                  ? { provider: 'mlx', model: selected.name }
                  : {
                      provider: 'lm-studio',
                      endpoint: lmStudioEndpoint,
                      model: startLMStudioModel,
                      appModel: runtime.appModel
                    }
              )
            }
            disabled={!canStartLMStudio}
            className="mt-6 w-full rounded-xl bg-white py-3 text-sm font-medium text-ink-900 transition hover:bg-white/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-ink-500"
          >
            {runtime.provider === 'mlx'
              ? `Download ${selected.label} · ${selected.size}`
              : canStartLMStudio
                ? 'Connect to LM Studio'
                : 'Load this Gemma model in LM Studio'}
          </button>
          <p className="mt-3 text-center text-[11px] text-ink-400">
            {runtime.provider === 'mlx'
              ? "We'll install MLX runtime if needed. Model weights are cached locally."
              : 'Your chats will stream through the LM Studio server on your machine.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function StageList({ status }: { status: SetupStatus }) {
  const stages: Array<{ key: SetupStatus['stage']; label: string }> = [
    { key: 'installing-mlx', label: 'Install MLX runtime' },
    { key: 'starting-mlx', label: 'Start runtime & load model' },
    { key: 'connecting-lm-studio', label: 'Connect to LM Studio' },
    { key: 'downloading-model', label: 'Download model' },
    { key: 'ready', label: 'Ready to chat' }
  ]
  const order: SetupStatus['stage'][] = [
    'checking',
    'installing-mlx',
    'starting-mlx',
    'connecting-lm-studio',
    'downloading-model',
    'ready'
  ]
  const currentIdx = order.indexOf(status.stage)

  return (
    <div className="space-y-3">
      {stages.map((s) => {
        const idx = order.indexOf(s.key)
        const state = idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending'
        return (
          <div key={s.key} className="flex items-center gap-3">
            <StageDot state={state} />
            <div className="flex-1">
              <div
                className={`text-sm transition ${
                  state === 'pending'
                    ? 'text-ink-400'
                    : state === 'active'
                      ? 'text-white'
                      : 'text-ink-200'
                }`}
              >
                {state === 'active' && status.message ? status.message : s.label}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StageDot({ state }: { state: 'pending' | 'active' | 'done' }) {
  if (state === 'done') {
    return (
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/85 text-ink-900">
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    )
  }
  if (state === 'active') {
    return (
      <div className="relative flex h-5 w-5 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-white/30" />
        <div className="h-2 w-2 rounded-full bg-white" />
      </div>
    )
  }
  return <div className="h-5 w-5 rounded-full border border-white/15" />
}

function GemmaLogo({ className }: { className?: string }) {
  return (
    <img
      src={gemmaLogoUrl}
      alt="Gemma"
      className={className}
      draggable={false}
    />
  )
}
