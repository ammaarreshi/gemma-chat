import { AVAILABLE_MODELS, getModelInfo, makeModelConfig, type ModelConfig, type SetupStatus } from '@shared/types'
import gemmaLogoUrl from '../assets/gemma-logo.png'

interface Props {
  status: SetupStatus
  config: ModelConfig
  onConfigChange: (config: ModelConfig) => void
  onStart: (config: ModelConfig) => void
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

export default function Setup({ status, config, onConfigChange, onStart }: Props) {
  const isWorking =
    status.stage === 'checking' ||
    status.stage === 'installing-mlx' ||
    status.stage === 'starting-mlx' ||
    status.stage === 'downloading-model'

  if (status.stage === 'checking' && status.message === 'Welcome') {
    return <WelcomeScreen config={config} onConfigChange={onConfigChange} onStart={onStart} />
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
                onClick={() => onStart(config)}
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
  config,
  onConfigChange,
  onStart
}: {
  config: ModelConfig
  onConfigChange: (config: ModelConfig) => void
  onStart: (config: ModelConfig) => void
}) {
  const selected = getModelInfo(config.model) ?? AVAILABLE_MODELS[1]
  const hasDraft = !!selected?.draft

  function toggleDraft(): void {
    onConfigChange(makeModelConfig(config.model, !config.draftModel))
  }

  const totalSize = config.draftModel && selected.draft
    ? `${selected.size} + ${selected.draft.size}`
    : selected.size

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
            Pick a model
          </div>
          <div className="anim-stagger space-y-2">
            {AVAILABLE_MODELS.map((m) => (
              <button
                key={m.name}
                onClick={() => onConfigChange(makeModelConfig(m.name, !!config.draftModel))}
                className={`anim-fade-up group relative w-full rounded-xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                  config.model === m.name
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

          {hasDraft && (
            <div className="anim-fade-up mt-4">
              <button
                onClick={toggleDraft}
                aria-pressed={!!config.draftModel}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition ${
                  config.draftModel
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                }`}
              >
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                  config.draftModel
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-white/20 bg-white/[0.04]'
                }`}>
                  {config.draftModel && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink-100">
                    Enable speculative decoding
                  </div>
                  <div className="text-xs text-ink-400">
                    Uses a small assistant model to accelerate generation
                    {selected.draft && (
                      <span> · +{selected.draft.size} download</span>
                    )}
                  </div>
                </div>
              </button>
            </div>
          )}

          <button
            onClick={() => onStart(config)}
            className="mt-6 w-full rounded-xl bg-white py-3 text-sm font-medium text-ink-900 transition hover:bg-white/90 active:scale-[0.99]"
          >
            Download {selected.label}{config.draftModel ? ' + Draft' : ''} &nbsp;·&nbsp; {totalSize}
          </button>
          <p className="mt-3 text-center text-[11px] text-ink-400">
            We'll install MLX runtime if needed. Model weights are cached locally.
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
    { key: 'downloading-model', label: 'Download model' },
    { key: 'ready', label: 'Ready to chat' }
  ]
  const order: SetupStatus['stage'][] = [
    'checking',
    'installing-mlx',
    'starting-mlx',
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
