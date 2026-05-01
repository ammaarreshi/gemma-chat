import { AVAILABLE_MODELS, type SetupStatus } from '@shared/types'
import vibeLogoUrl from '../assets/vibe-logo.png'

interface Props {
  status: SetupStatus
  model: string
  onModelChange: (m: string) => void
  onStart: (model: string) => void
  onUsePiAi: () => void
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

export default function Setup({ status, model, onModelChange, onStart, onUsePiAi }: Props) {
  const isWorking =
    status.stage === 'checking' ||
    status.stage === 'installing-mlx' ||
    status.stage === 'starting-mlx' ||
    status.stage === 'downloading-model'

  if (status.stage === 'checking' && status.message === 'Welcome') {
    return (
      <WelcomeScreen
        model={model}
        onModelChange={onModelChange}
        onStart={onStart}
        onUsePiAi={onUsePiAi}
      />
    )
  }

  return (
    <div className="drag flex h-full w-full flex-col">
      <div className="h-9" />
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-md">
          <div className="mb-8 text-center">
            <VibeLogo className="mx-auto mb-5 h-20 w-20" />
            <h1 className="text-[22px] font-semibold tracking-tight">Setting things up</h1>
            <p className="mt-1.5 text-sm text-muted">
              Everything runs locally. Nothing leaves your Mac.
            </p>
          </div>

          <StageList status={status} />

          {isWorking && status.progress != null && (
            <div className="mt-6">
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-control">
                <div
                  className="h-full rounded-full bg-accent-green transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(2, Math.round((status.progress ?? 0) * 100))}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted">
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
            <div className="mt-6 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              <div className="font-medium">Something went wrong</div>
              <div className="mt-1 text-danger/80">{status.error}</div>
              <button
                onClick={() => onStart(model)}
                className="mt-3 rounded-md border border-line bg-control px-3 py-1.5 text-xs hover:bg-control-hover"
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
  model,
  onModelChange,
  onStart,
  onUsePiAi
}: {
  model: string
  onModelChange: (m: string) => void
  onStart: (model: string) => void
  onUsePiAi: () => void
}) {
  const selected = AVAILABLE_MODELS.find((m) => m.name === model) ?? AVAILABLE_MODELS[1]
  return (
    <div className="drag flex h-full w-full flex-col">
      <div className="h-9" />
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-md">
          <div className="anim-fade-up mb-8 text-center">
            <VibeLogo className="mx-auto mb-5 h-24 w-24" />
            <h1 className="text-[26px] font-semibold tracking-tight">Welcome to Vibe Chat</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              A local AI assistant for chat and vibe coding.
              <br />
              Runs 100% on your Mac. No account, no cloud.
            </p>
          </div>

          <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-faint">
            Pick a model
          </div>
          <div className="anim-stagger space-y-2">
            {AVAILABLE_MODELS.map((m) => (
              <button
                key={m.name}
                onClick={() => onModelChange(m.name)}
                className={`anim-fade-up group relative w-full rounded-xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                  model === m.name
                    ? 'border-sidebar-active bg-panel-strong'
                    : 'border-line bg-panel hover:border-sidebar-active hover:bg-panel-strong'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.label}</span>
                    {m.recommended && (
                      <span className="rounded-full bg-control px-2 py-[1px] text-[10px] font-medium uppercase tracking-wider text-ink-100">
                        Recommended
                      </span>
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-muted">{m.size}</span>
                </div>
                <div className="mt-1 text-[12.5px] leading-snug text-muted">
                  {m.description}
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={() => onStart(selected.name)}
            className="mt-6 w-full rounded-xl bg-action py-3 text-sm font-medium text-action-fg transition hover:opacity-90 active:scale-[0.99]"
          >
            Download {selected.label} &nbsp;·&nbsp; {selected.size}
          </button>
          <button
            onClick={onUsePiAi}
            className="mt-2 w-full rounded-xl border border-line bg-panel py-3 text-sm font-medium text-fg transition hover:border-sidebar-active hover:bg-panel-strong active:scale-[0.99]"
          >
            Use Pi AI Provider
          </button>
          <p className="mt-3 text-center text-[11px] text-muted">
            Local MLX works offline. Pi AI uses provider credentials and does not require MLX.
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
                    ? 'text-muted'
                    : state === 'active'
                      ? 'text-fg'
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
      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-white">
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    )
  }
  if (state === 'active') {
    return (
      <div className="relative flex h-5 w-5 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-accent-yellow/40" />
        <div className="h-2 w-2 rounded-full bg-accent-yellow" />
      </div>
    )
  }
  return <div className="h-5 w-5 rounded-full border border-line" />
}

function VibeLogo({ className }: { className?: string }) {
  return (
    <img
      src={vibeLogoUrl}
      alt="Vibe Chat"
      className={className}
      draggable={false}
    />
  )
}
