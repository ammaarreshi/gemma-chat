import { runtimeModelName } from '@shared/types'

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

function baseUrl(): string {
  const host = process.env.OLLAMA_HOST?.trim()
  if (!host) return DEFAULT_OLLAMA_URL
  if (host.startsWith('http://') || host.startsWith('https://')) return host.replace(/\/+$/, '')
  return `http://${host.replace(/\/+$/, '')}`
}

async function fetchWithTimeout(url: string, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface OllamaStatus {
  running: boolean
  url: string
  models: string[]
}

export async function locateOllama(): Promise<OllamaStatus> {
  const url = baseUrl()
  try {
    const res = await fetchWithTimeout(`${url}/v1/models`)
    if (!res.ok) return { running: false, url, models: [] }
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return {
      running: true,
      url,
      models: (data.data ?? []).map((m) => m.id)
    }
  } catch {
    return { running: false, url, models: [] }
  }
}

export async function ensureOllamaModel(model: string): Promise<void> {
  const ollama = await locateOllama()
  const runtimeName = runtimeModelName(model)

  if (!ollama.running) {
    throw new Error(
      `Ollama is not reachable at ${ollama.url}. Start Ollama, then try again.`
    )
  }

  if (!ollama.models.includes(runtimeName)) {
    throw new Error(
      `Ollama is running, but ${runtimeName} is not installed. Run: ollama pull ${runtimeName}`
    )
  }
}

export async function listOllamaModels(): Promise<string[]> {
  const ollama = await locateOllama()
  return ollama.models
}

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

export async function* ollamaChatStream(
  opts: OllamaChatOptions
): AsyncGenerator<{ content?: string; done?: boolean }> {
  const url = baseUrl()
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: runtimeModelName(opts.model),
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content
      })),
      stream: true,
      temperature: opts.temperature ?? 0.7,
      max_tokens: 8192
    }),
    signal: opts.signal
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama chat request failed: ${res.status} ${res.statusText} — ${text}`)
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
      if (choice?.delta?.content) {
        yield { content: choice.delta.content }
      }
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
