import { useEffect, useRef, useState } from 'react'
import { transcribeAudioBlob } from '../lib/whisper'

interface Props {
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
  placeholder?: string
  model: string
}

type RecState = 'idle' | 'recording' | 'loading-model' | 'transcribing'

export default function Composer({
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  model: _model
}: Props) {
  const [text, setText] = useState('')
  const [recState, setRecState] = useState<RecState>('idle')
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [modelProgress, setModelProgress] = useState<{ pct: number; label: string } | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = 220
    el.style.height = Math.min(el.scrollHeight, max) + 'px'
  }, [text])

  function submit(): void {
    const t = text.trim()
    if (!t || streaming || disabled) return
    onSend(t)
    setText('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  async function startRecording(): Promise<void> {
    setRecordError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        if (blob.size < 500) {
          setRecState('idle')
          setRecordSeconds(0)
          setRecordError('Recording too short')
          return
        }
        setRecState('loading-model')
        try {
          const result = await transcribeAudioBlob(blob, (ev) => {
            if (ev.status === 'progress' && typeof ev.progress === 'number') {
              setModelProgress({
                pct: ev.progress,
                label: ev.file ?? 'whisper model'
              })
            } else if (ev.status === 'ready' || ev.status === 'done') {
              setModelProgress(null)
              setRecState('transcribing')
            } else if (ev.status === 'initiate' || ev.status === 'download') {
              setModelProgress({ pct: 0, label: ev.file ?? 'whisper model' })
            }
          })
          setRecState('transcribing')
          if (result) {
            setText((prev) => (prev ? prev + ' ' + result : result))
            setTimeout(() => taRef.current?.focus(), 0)
          } else {
            setRecordError("Couldn't pick up any speech. Try again a bit louder.")
          }
        } catch (e) {
          setRecordError((e as Error).message)
        } finally {
          setRecState('idle')
          setRecordSeconds(0)
          setModelProgress(null)
        }
      }
      rec.start()
      mediaRef.current = rec
      setRecState('recording')
      setRecordSeconds(0)
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1)
      }, 1000)
    } catch (e) {
      setRecordError((e as Error).message || 'Microphone access denied')
      setRecState('idle')
    }
  }

  function stopRecording(): void {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    mediaRef.current?.stop()
    mediaRef.current = null
  }

  function onMicClick(): void {
    if (recState === 'idle') {
      startRecording()
    } else if (recState === 'recording') {
      stopRecording()
    }
  }

  const canSend = text.trim().length > 0 && !disabled && recState === 'idle'

  return (
    <div className="shrink-0 px-6 pb-6 pt-2">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-lg shadow-shadow/20 focus-within:border-sidebar-active">
          <MicButton
            state={recState}
            seconds={recordSeconds}
            onClick={onMicClick}
            disabled={streaming || disabled}
          />
          <textarea
            ref={taRef}
            data-composer
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              recState === 'recording'
                ? 'Listening…'
                : recState === 'transcribing'
                  ? 'Transcribing…'
                  : (placeholder ?? 'Message Vibe…')
            }
            rows={1}
            disabled={disabled || recState !== 'idle'}
            className="min-h-[28px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14.5px] leading-relaxed text-fg placeholder:text-muted focus:outline-none disabled:opacity-50"
          />
          {streaming ? (
            <button
              onClick={onStop}
              aria-label="Stop"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-action text-action-fg transition hover:opacity-90"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
                <rect x="2" y="2" width="8" height="8" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-action text-action-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-control disabled:text-faint"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                <path d="M2 8l12-6-4 14-2-6-6-2z" />
              </svg>
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-muted">
          {recordError ? (
            <span className="text-danger">{recordError}</span>
          ) : recState === 'recording' ? (
            <span>Click mic again to stop.</span>
          ) : recState === 'loading-model' ? (
            modelProgress ? (
              <span className="shimmer-text">
                Downloading Whisper model… {Math.round((modelProgress.pct ?? 0))}%
              </span>
            ) : (
              <span className="shimmer-text">Loading Whisper…</span>
            )
          ) : recState === 'transcribing' ? (
            <span className="shimmer-text">Transcribing locally…</span>
          ) : (
            <span>Enter to send · Shift+Enter for newline · mic for voice</span>
          )}
        </div>
      </div>
    </div>
  )
}

function MicButton({
  state,
  seconds,
  onClick,
  disabled
}: {
  state: RecState
  seconds: number
  onClick: () => void
  disabled: boolean
}) {
  if (state === 'recording') {
    return (
      <button
        onClick={onClick}
        className="flex h-9 items-center gap-1.5 rounded-xl bg-danger px-3 text-[11.5px] font-medium text-white transition hover:opacity-90"
        aria-label="Stop recording"
      >
        <span className="flex h-2 w-2 items-center justify-center">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
        </span>
        <span className="tabular-nums">{formatTime(seconds)}</span>
      </button>
    )
  }
  if (state === 'transcribing' || state === 'loading-model') {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-control">
        <svg className="h-4 w-4 animate-spin text-ink-200" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 100" />
        </svg>
      </div>
    )
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Voice input"
      aria-label="Record voice"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-control hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
        <path d="M8 2a2 2 0 0 0-2 2v5a2 2 0 0 0 4 0V4a2 2 0 0 0-2-2z" />
        <path
          d="M4 9a4 4 0 0 0 8 0M8 13v1.5"
          stroke="currentColor"
          strokeWidth="1.3"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function pickMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
  }
  return undefined
}
