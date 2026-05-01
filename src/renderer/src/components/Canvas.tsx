import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceFile } from '@shared/types'

interface Props {
  conversationId: string
  streaming: boolean
  onClose: () => void
}

type Tab = 'preview' | 'files' | 'code'

interface LiveFile {
  path: string
  content: string
  done: boolean
}

export default function Canvas({ conversationId, streaming, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('preview')
  const [port, setPort] = useState(0)
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [liveFile, setLiveFile] = useState<LiveFile | null>(null)
  const [autoSwitched, setAutoSwitched] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const refreshTimer = useRef<number | null>(null)

  useEffect(() => {
    ;(async () => {
      const p = await window.api.workspaceServerPort()
      setPort(p)
    })()
  }, [])

  useEffect(() => {
    refreshFiles()
    setSelectedFile(null)
    setLiveFile(null)
    setAutoSwitched(false)
    setNonce((n) => n + 1)
  }, [conversationId])

  useEffect(() => {
    const unsub = window.api.onWorkspaceChanged((ev) => {
      if (ev.conversationId !== conversationId) return
      refreshFiles()
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
      refreshTimer.current = window.setTimeout(() => {
        setNonce((n) => n + 1)
      }, 350)
    })
    return unsub
  }, [conversationId])

  useEffect(() => {
    const unsub = window.api.onFileStreaming((ev) => {
      if (ev.conversationId !== conversationId) return
      setLiveFile({ path: ev.path, content: ev.content, done: ev.done })
      // Auto-switch to Code view on first live update so the user sees it typing
      if (!ev.done && !autoSwitched) {
        setTab('code')
        setAutoSwitched(true)
      }
      // When done, drop back to Preview after a beat so they see the final result
      if (ev.done) {
        window.setTimeout(() => {
          setTab((current) => (current === 'code' ? 'preview' : current))
          setAutoSwitched(false)
        }, 1400)
      }
    })
    return unsub
  }, [conversationId, autoSwitched])

  async function refreshFiles(): Promise<void> {
    try {
      const list = await window.api.listWorkspace(conversationId)
      setFiles(list)
    } catch {
      setFiles([])
    }
  }

  const previewSrc = useMemo(() => {
    if (!port) return ''
    const base = `http://127.0.0.1:${port}/${encodeURIComponent(conversationId)}/`
    const path = selectedFile ? encodeURI(selectedFile) : ''
    return `${base}${path}?v=${nonce}`
  }, [port, conversationId, nonce, selectedFile])

  const fileCount = files.filter((f) => f.kind === 'file').length

  return (
    <div className="flex h-full w-full flex-col border-l border-white/[0.06] bg-ink-950">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/[0.06] px-3">
        <div className="flex rounded-md bg-white/[0.04] p-0.5">
          <TabButton label="Preview" active={tab === 'preview'} onClick={() => setTab('preview')} />
          <TabButton
            label={
              <>
                Code
                {liveFile && !liveFile.done && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                )}
              </>
            }
            active={tab === 'code'}
            onClick={() => setTab('code')}
          />
          <TabButton
            label={`Files${fileCount ? ` · ${fileCount}` : ''}`}
            active={tab === 'files'}
            onClick={() => setTab('files')}
          />
        </div>
        <div className="flex-1" />
        {streaming && (
          <span className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-[11px] text-ink-200">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Building…
          </span>
        )}
        <IconButton title="Refresh preview" onClick={() => setNonce((n) => n + 1)}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconButton>
        <IconButton
          title="Open workspace folder"
          onClick={() => window.api.openWorkspace(conversationId)}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M2 4a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" />
          </svg>
        </IconButton>
        <IconButton title="Close canvas" onClick={onClose}>
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4L4 12" strokeLinecap="round" />
          </svg>
        </IconButton>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'preview' && (
          <div key="preview" className="anim-fade-in relative h-full w-full">
            {previewSrc ? (
              <iframe
                ref={iframeRef}
                src={previewSrc}
                className="h-full w-full border-0 bg-white"
                title="Preview"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-400">
                Starting preview server…
              </div>
            )}
            {selectedFile && (
              <div className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[11px] text-ink-100 backdrop-blur">
                {selectedFile}
                <button
                  onClick={() => setSelectedFile(null)}
                  className="ml-2 text-ink-400 hover:text-white"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'code' && <div key="code" className="anim-fade-in h-full"><CodeView live={liveFile} /></div>}

        {tab === 'files' && (
          <div key="files" className="anim-fade-in h-full">
            <FileList
              files={files}
              onOpen={(path) => {
                setSelectedFile(path)
                setTab('preview')
                setNonce((n) => n + 1)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function CodeView({ live }: { live: LiveFile | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      userScrolledRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 60
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!ref.current || userScrolledRef.current) return
    ref.current.scrollTop = ref.current.scrollHeight
  }, [live?.content])

  if (!live) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-ink-400">
        Nothing streaming right now. The code tab lights up while Gemma writes a file.
      </div>
    )
  }
  const lines = live.content.split('\n')
  const lineCount = lines.length
  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-4 py-2 text-[11.5px]">
        <div className="flex items-center gap-2">
          {!live.done ? (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-ink-400" />
          )}
          <span className="font-mono text-ink-100">{live.path}</span>
        </div>
        <div className="tabular-nums text-ink-400">
          {lineCount} line{lineCount === 1 ? '' : 's'} · {live.content.length.toLocaleString()} chars
          {!live.done && <span className="ml-2 shimmer-text">writing</span>}
        </div>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full font-mono text-[12px] leading-[1.55]">
          <div className="sticky left-0 shrink-0 select-none border-r border-white/[0.04] bg-[#0a0a0a] px-3 py-3 text-right text-ink-400/60 tabular-nums">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <pre className="flex-1 whitespace-pre px-4 py-3 text-ink-100">
            {live.content}
            {!live.done && <span className="anim-caret">▍</span>}
          </pre>
        </div>
      </div>
    </div>
  )
}

function TabButton({
  label,
  active,
  onClick
}: {
  label: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center rounded px-2.5 py-1 text-[11.5px] font-medium transition ${
        active ? 'bg-white/10 text-white' : 'text-ink-400 hover:text-ink-100'
      }`}
    >
      {label}
    </button>
  )
}

function IconButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-white/5 hover:text-white"
    >
      {children}
    </button>
  )
}

function FileList({
  files,
  onOpen
}: {
  files: WorkspaceFile[]
  onOpen: (path: string) => void
}) {
  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-ink-400">
        No files yet. Ask Gemma to build something — files appear here as it writes them.
      </div>
    )
  }
  return (
    <div className="h-full overflow-y-auto p-2 font-mono text-[12.5px]">
      {files.map((f) => {
        const depth = (f.path.match(/\//g) || []).length
        const name = f.path.split('/').pop() || f.path
        if (f.kind === 'dir') {
          return (
            <div key={f.path} style={{ paddingLeft: 8 + depth * 12 }} className="py-1 text-ink-400">
              <span className="mr-1">▸</span>
              {name}/
            </div>
          )
        }
        return (
          <button
            key={f.path}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => onOpen(f.path)}
            className="flex w-full items-center justify-between py-1 text-left text-ink-100 hover:bg-white/5"
          >
            <span className="truncate">{name}</span>
            {f.size != null && (
              <span className="ml-2 shrink-0 text-[10.5px] text-ink-400">{formatSize(f.size)}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function formatSize(n: number): string {
  if (n < 1024) return n + 'B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'K'
  return (n / (1024 * 1024)).toFixed(1) + 'M'
}
