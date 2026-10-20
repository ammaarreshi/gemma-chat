import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const ENDPOINT = 'https://search.parallel.ai/mcp'
const USER_AGENT = 'Gemma-Chat/0.1.0 (+https://github.com/ammaarreshi/gemma-chat)'
const TIMEOUT_MS = 20_000

// The app owns conversation IDs. Keep one opaque MCP ID per conversation across
// turns, even though each call has its own transport and cancellation lifetime.
const sessions = new Map<string, string>()
export function parallelSessionId(conversationId: string): string {
  let id = sessions.get(conversationId)
  if (!id) {
    id = randomUUID()
    sessions.set(conversationId, id)
  }
  return id
}

export function searchProvider(): 'duckduckgo' | 'parallel' {
  const value = process.env.GEMMA_SEARCH_PROVIDER?.trim() || 'duckduckgo'
  if (value !== 'duckduckgo' && value !== 'parallel') {
    throw new Error('GEMMA_SEARCH_PROVIDER must be duckduckgo or parallel')
  }
  return value
}

export interface ParallelContext {
  conversationId: string
  signal?: AbortSignal
  modelName?: string
}

export async function parallelTool(
  name: 'web_search' | 'web_fetch',
  args: Record<string, unknown>,
  ctx: ParallelContext
): Promise<string> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS)
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline
  signal.throwIfAborted()
  const client = new Client({ name: 'gemma-chat', version: '0.1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    // Apply the project identity and deadline to initialization, discovery and
    // tool requests, including the transport's own HTTP requests.
    fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('User-Agent', USER_AGENT)
      return fetch(input, {
        ...init,
        headers,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal
      })
    }
  })
  const options = { signal, timeout: TIMEOUT_MS }
  try {
    await client.connect(transport, options)
    const tools = await client.listTools({}, options)
    if (!tools.tools.some((tool) => tool.name === name)) {
      throw new Error(`Parallel does not advertise ${name}`)
    }
    const result = await client.callTool(
      {
        name,
        arguments: {
          ...args,
          session_id: parallelSessionId(ctx.conversationId),
          ...(ctx.modelName ? { model_name: ctx.modelName } : {})
        }
      },
      undefined,
      options
    )
    const text = Array.isArray(result.content)
      ? result.content
          .filter((item) => item.type === 'text' && typeof item.text === 'string')
          .map((item) => item.text as string)
          .join('\n')
      : ''
    if (result.isError) throw new Error(text || 'Parallel tool failed')
    if (!text.trim()) throw new Error('Parallel returned no text content')
    const limit = name === 'web_fetch' ? 8_000 : 16_000
    return text.length > limit ? text.slice(0, limit) + '\n[…truncated]' : text
  } catch (error) {
    if (ctx.signal?.aborted) throw ctx.signal.reason
    if (deadline.aborted) throw new Error('Parallel request timed out after 20 seconds')
    throw error
  } finally {
    await client.close().catch(() => { /* Do not mask a tool result or error. */ })
  }
}
