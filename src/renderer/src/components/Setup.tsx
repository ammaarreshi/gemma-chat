import {
  modelProvider,
  runtimeModelName,
  type ModelInfo,
  type SetupStatus
} from '@shared/types'
import gemmaLogoUrl from '../assets/gemma-logo.png'

interface Props {
  models: ModelInfo[]
  status: SetupStatus
  model: string
  onModelChange: (m: string) => void
  onStart: (model: string) => void
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

export default function Setup({ models, status, model, onModelChange, onStart }: Props) {
  const isWorking =
    status.stage === 'checking' ||
    status.stage === 'installing-mlx' ||
    status.stage === 'starting-mlx' ||
    status.stage === 'connecting-ollama' ||
    status.stage === 'downloading-model'

  if (status.stage === 'checking' && status.message === 'Welcome') {
    return (
      <WelcomeScreen
        models={models}
        model={model}
        onModelChange={onModelChange}
        onStart={onStart}
      />
    )
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
              Everything runs locally. Nothing leaves your machine.
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
                onClick={() => onStart(model)}
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
  models,
  model,
  onModelChange,
  onStart
}: {
  models: ModelInfo[]
  model: string
  onModelChange: (m: string) => void
  onStart: (model: string) => void
}) {
  const selected = models.find((m) => m.name === model) ?? models[0]
  const selectedProvider = selected ? modelProvider(selected.name) : 'mlx'
  const cta =
    selectedProvider === 'ollama'
      ? `Use ${selected.label}`
      : `Download ${selected.label}  ·  ${selected.size}`
  const note =
    selectedProvider === 'ollama'
      ? `Requires Ollama running locally with ${runtimeModelName(selected.name)} installed.`
      : "We'll install MLX runtime if needed. Model weights are cached locally."

  return (
    <div className="drag flex h-full w-full flex-col">
      <div className="h-9" />
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-md">
          <div className="anim-fade-up mb-8 text-center">
            <GemmaLogo className="mx-auto mb-5 h-24 w-24" />
            <h1 className="text-[26px] font-semibold tracking-tight">Welcome to Gemma Chat</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-400">
              A local AI assistant, powered by Gemma.
              <br />
              No account, no cloud.
            </p>
          </div>

          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-400">
            Pick a model
          </div>
          <div className="anim-stagger max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {models.map((m) => (
              <button
                key={m.name}
                onClick={() => onModelChange(m.name)}
                className={`anim-fade-up group relative w-full rounded-xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                  model === m.name
                    ? 'border-white/25 bg-white/[0.06]'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{m.label}</span>
                    <ProviderBadge provider={m.provider} />
                    {m.recommended && (
                      <span className="rounded-full bg-white/10 px-2 py-[1px] text-[10px] font-medium uppercase tracking-wider text-ink-100">
                        Recommended
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-ink-400">{m.size}</span>
                </div>
                <div className="mt-1 text-[12.5px] leading-snug text-ink-400">
                  {m.description}
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={() => onStart(selected.name)}
            className="mt-6 w-full rounded-xl bg-white py-3 text-sm font-medium text-ink-900 transition hover:bg-white/90 active:scale-[0.99]"
          >
            {cta}
          </button>
          <p className="mt-3 text-center text-[11px] text-ink-400">{note}</p>
        </div>
      </div>
    </div>
  )
}

function StageList({ status }: { status: SetupStatus }) {
  const isOllama =
    status.stage === 'connecting-ollama' || status.message.toLowerCase().includes('ollama')
  const stages: Array<{ key: SetupStatus['stage']; label: string }> = isOllama
    ? [
        { key: 'connecting-ollama', label: 'Connect to Ollama' },
        { key: 'ready', label: 'Ready to chat' }
      ]
    : [
        { key: 'installing-mlx', label: 'Install MLX runtime' },
        { key: 'starting-mlx', label: 'Start runtime & load model' },
        { key: 'downloading-model', label: 'Download model' },
        { key: 'ready', label: 'Ready to chat' }
      ]
  const order: SetupStatus['stage'][] = isOllama
    ? ['checking', 'connecting-ollama', 'ready']
    : ['checking', 'installing-mlx', 'starting-mlx', 'downloading-model', 'ready']
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

function ProviderBadge({ provider }: { provider: ModelInfo['provider'] }) {
  return (
    <span className="rounded-full bg-white/10 px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-ink-200">
      {provider}
    </span>
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
  return <img src={gemmaLogoUrl} alt="Gemma" className={className} draggable={false} />
}
