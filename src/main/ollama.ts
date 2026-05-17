// Ollama HTTP client for gemma-chat (Windows port)
//
// Replaces the original mlx.ts MLX-LM backend with a thin Ollama client.
// Ollama runs as a system service on Windows (installed separately from
// https://ollama.com/download/windows) and exposes:
//   - /api/version, /api/tags, /api/pull   (Ollama-native)
//   - /v1/chat/completions, /v1/models     (OpenAI-compatible)
//
// We use the OpenAI-compatible endpoints for chat so the streaming SSE
// parser stays identical to the original MLX implementation.

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? '127.0.0.1:11434'
const OLLAMA_URL = OLLAMA_HOST.startsWith('http') ? OLLAMA_HOST : `http://${OLLAMA_HOST}`

let currentModel: string | null = null

// ---------------------------------------------------------------------------
// Server detection
// ---------------------------------------------------------------------------

export interface OllamaStatus {
  /** Ollama version string (e.g. "0.1.32"), or null if not reachable */
  version: string | null
  /** Whether the Ollama daemon responded to /api/version */
  running: boolean
}

/** Probe Ollama. Returns version if running, null otherwise. */
export async function locateOllama(): Promise<OllamaStatus> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 3000)
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: ctl.signal })
    clearTimeout(timer)
    if (!res.ok) return { version: null, running: false }
    const data = (await res.json()) as { version?: string }
    return { version: data.version ?? 'unknown', running: true }
  } catch {
    return { version: null, running: false }
  }
}

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

export interface PullProgress {
  message: string
  /** 0.0–1.0 progress fraction, if known */
  progress?: number
  bytesDone?: number
  bytesTotal?: number
}

/**
 * Pull a model from the Ollama registry, streaming progress.
 * No-op if the model is already present locally.
 */
export async function pullModel(
  model: string,
  onProgress?: (p: PullProgress) => void
): Promise<void> {
  const have = await hasModel(model)
  if (have) {
    onProgress?.({ message: `Model ${model} already installed.`, progress: 1 })
    return
  }

  onProgress?.({ message: `Downloading ${model}…`, progress: 0 })

  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: model, stream: true })
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to pull ${model}: ${res.status} ${res.statusText} ${text}`)
  }

  const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buf = ''

  // Ollama /api/pull streams newline-delimited JSON objects
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const evt = JSON.parse(line) as {
          status?: string
          digest?: string
          total?: number
          completed?: number
          error?: string
        }
        if (evt.error) throw new Error(evt.error)
        const total = evt.total ?? 0
        const completed = evt.completed ?? 0
        const progress = total > 0 ? completed / total : undefined
        onProgress?.({
          message: evt.status ?? 'Downloading…',
          progress,
          bytesDone: completed || undefined,
          bytesTotal: total || undefined
        })
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.startsWith('Unexpected')) throw e
      }
    }
  }

  // Verify the pull landed
  const ok = await hasModel(model)
  if (!ok) throw new Error(`Model ${model} did not appear in local list after pull.`)
  onProgress?.({ message: 'Download complete.', progress: 1 })
}

/** List the models that Ollama has locally. */
export async function listLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`)
    if (!res.ok) return []
    const data = (await res.json()) as { models?: Array<{ name: string; model?: string }> }
    return (data.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean)
  } catch {
    return []
  }
}

export async function hasModel(name: string): Promise<boolean> {
  const models = await listLocalModels()
  // Ollama returns names with the ":tag" suffix; accept exact or prefix match
  return models.some((m) => m === name || m.startsWith(`${name}:`) || name.startsWith(`${m}:`))
}

/**
 * Warm a model into memory by sending an empty /api/generate request.
 * Optional — the first chat will load it anyway, but pre-warming makes
 * the first response faster.
 */
export async function warmModel(model: string): Promise<void> {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: '10m' })
    })
    currentModel = model
  } catch {
    // Best-effort; ignore failures
  }
}

/** Unload a model from memory (used when switching models). */
export async function unloadModel(model: string): Promise<void> {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 })
    })
  } catch {
    // ignore
  }
  if (currentModel === model) currentModel = null
}

// ---------------------------------------------------------------------------
// Chat streaming (OpenAI-compatible SSE)
// ---------------------------------------------------------------------------

export interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: string[]
}

export interface OllamaChatOptions {
  model: string
  messages: OllamaChatMessage[]
  signal?: AbortSignal
  temperature?: number
}

export async function* chatStream(
  opts: OllamaChatOptions
): AsyncGenerator<{ content?: string; done?: boolean }> {
  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      temperature: opts.temperature ?? 0.7,
      max_tokens: 8192
    }),
    signal: opts.signal
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Chat request failed: ${res.status} ${res.statusText} — ${text}`)
  }

  const stream = res.body as unknown as ReadableStream<Uint8Array>
  for await (const event of readSSE(stream)) {
    if (event === '[DONE]') {
      yield { done: true }
      return
    }
    try {
      const parsed = JSON.parse(event) as {
        choices?: Array<{
          delta?: { content?: string; role?: string }
          finish_reason?: string | null
        }>
      }
      const choice = parsed.choices?.[0]
      if (choice?.delta?.content) yield { content: choice.delta.content }
      if (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length') {
        yield { done: true }
        return
      }
    } catch {
      // Skip malformed events
    }
  }
  yield { done: true }
}

async function* readSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 2)
      if (!block) continue
      for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data) yield data
        }
      }
    }
  }

  if (buf.trim()) {
    for (const line of buf.trim().split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data) yield data
      }
    }
  }
}

export { OLLAMA_URL }
