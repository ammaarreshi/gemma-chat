import { runtimeModelName } from '@shared/types'
import { request as httpRequest, type IncomingMessage } from 'http'
import { request as httpsRequest } from 'https'

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
const DEFAULT_OLLAMA_CHAT_TIMEOUT_MS = 30 * 60 * 1000

function baseUrl(): string {
  const host = process.env.OLLAMA_HOST?.trim()
  if (!host) return DEFAULT_OLLAMA_URL
  if (host.startsWith('http://') || host.startsWith('https://')) {
    return host.replace(/\/+$/, '')
  }
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
    throw new Error(`Ollama is not reachable at ${ollama.url}. Start Ollama, then try again.`)
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
  let res: IncomingMessage
  try {
    res = await postJson(`${url}/v1/chat/completions`, {
        model: runtimeModelName(opts.model),
        messages: opts.messages.map((m) => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: m.content
        })),
        stream: true,
        temperature: opts.temperature ?? 0.7,
        max_tokens: 8192
      },
      opts.signal
    )
  } catch (e) {
    throw new Error(`Ollama fetch failed at ${url}: ${describeFetchError(e)}`)
  }

  const statusCode = res.statusCode ?? 0
  if (statusCode < 200 || statusCode >= 300) {
    const text = await readBodyText(res).catch(() => '')
    throw new Error(`Ollama chat request failed: ${statusCode} ${res.statusMessage ?? ''} - ${text}`)
  }

  for await (const event of readSSE(res)) {
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
      // Skip malformed events.
    }
  }
  yield { done: true }
}

function describeFetchError(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  const cause = e.cause instanceof Error ? ` (${e.cause.message})` : ''
  return `${e.message}${cause}`
}

function ollamaChatTimeoutMs(): number {
  const raw = process.env.GEMMA_CHAT_OLLAMA_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OLLAMA_CHAT_TIMEOUT_MS
}

function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<IncomingMessage> {
  const parsed = new URL(url)
  const payload = JSON.stringify(body)
  const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest
  const timeoutMs = ollamaChatTimeoutMs()

  return new Promise((resolve, reject) => {
    const req = request(
      parsed,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload)
        }
      },
      resolve
    )

    const abort = (): void => {
      req.destroy(new Error('request aborted'))
    }

    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(`timed out waiting for Ollama response headers after ${Math.round(timeoutMs / 1000)}s`)
      )
    })
    req.on('error', reject)
    signal?.addEventListener('abort', abort, { once: true })
    req.on('close', () => signal?.removeEventListener('abort', abort))
    req.end(payload)
  })
}

async function readBodyText(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let out = ''
  for await (const value of stream) {
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

async function* readSSE(stream: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buf = ''

  for await (const value of stream) {
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
  buf += decoder.decode()

  if (buf.trim()) {
    for (const line of buf.trim().split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data) yield data
      }
    }
  }
}
