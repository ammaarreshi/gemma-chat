import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChatRequest, StreamChunk } from '../src/shared/types'

const host = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  events: [] as Array<{ channel: string; chunk: StreamChunk }>,
  scripts: new Map<string, { actions: string[]; messages: any[][]; round: number }>()
}))

vi.mock('electron', () => ({
  app: { whenReady: () => Promise.resolve(), on: vi.fn(), quit: vi.fn() },
  shell: {}, nativeTheme: {}, nativeImage: {},
  session: { defaultSession: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() } },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => host.handlers.set(name, handler) },
  BrowserWindow: class {
    webContents = {
      send: (channel: string, chunk: StreamChunk) => host.events.push({ channel, chunk }),
      setWindowOpenHandler: vi.fn(), openDevTools: vi.fn()
    }
    on = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
  }
}))
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() }, optimizer: { watchWindowShortcuts: vi.fn() }, is: { dev: false }
}))
vi.mock('../src/main/workspace', () => ({
  startWorkspaceServer: vi.fn(), stopWorkspaceServer: vi.fn(), ensureWorkspace: async () => '/tmp/workspace',
  previewUrl: () => 'http://localhost:1234', getWorkspaceServerPort: () => 1234,
  listTree: vi.fn(), workspaceDir: vi.fn(), wsWriteFile: vi.fn(), wsReadFile: vi.fn(),
  wsEditFile: vi.fn(), wsDeleteFile: vi.fn(), wsRunBash: vi.fn()
}))
vi.mock('../src/main/mlx', () => ({
  locateMLX: vi.fn(), installMLX: vi.fn(), startServer: vi.fn(), stopServer: vi.fn(),
  hasModel: vi.fn(), listLocalModels: vi.fn(),
  chatStream: async function* (options: any) {
    options.signal.throwIfAborted()
    const key = options.messages.find((m: any) => m.role === 'user').content
    const script = host.scripts.get(key)!
    script.messages.push(structuredClone(options.messages))
    yield { content: script.actions[script.round++] ?? 'Answer using the tool result.', done: false }
    yield { done: true }
  }
}))

const realFetch = globalThis.fetch

interface RequestRecord { url: string; init: RequestInit; rpc?: any }
let requests: RequestRecord[]
let toolResponse: (rpc: any, init: RequestInit) => Promise<Response> | Response
const search = '<action name="web_search"><query>Gemma release notes</query></action>'
const pageUrl = 'https://example.com/docs?lang=en&version=4'
const fetchPage = `<action name="fetch_url"><url>${pageUrl}</url></action>`
const json = (id: number, result: unknown) => Response.json({ jsonrpc: '2.0', id, result })

beforeAll(async () => {
  await import('../src/main/index')
  await vi.waitFor(() => expect(host.handlers.has('chat:send')).toBe(true))
})

beforeEach(() => {
  host.events.length = 0
  host.scripts.clear()
  requests = []
  vi.stubEnv('GEMMA_SEARCH_PROVIDER', 'parallel')
  // Ambient credentials must never turn this opt-in anonymous provider into an authenticated one.
  vi.stubEnv('PARALLEL_API_KEY', 'unused-ambient-key')
  toolResponse = (rpc) => json(rpc.id, {
    content: [{ type: 'text', text: `Source: ${pageUrl}\nUseful page excerpts.` }]
  })
  vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = String(input)
    const rpc = init.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ url, init, rpc })
    if (init.method === 'GET') return new Response(null, { status: 405 })
    if (rpc?.method === 'initialize') return json(rpc.id, {
      protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' }
    })
    if (rpc?.method?.startsWith('notifications/')) return new Response(null, { status: 202 })
    if (rpc?.method === 'tools/list') return json(rpc.id, {
      tools: ['web_search', 'web_fetch'].map((name) => ({ name, inputSchema: { type: 'object' } }))
    })
    if (rpc?.method === 'tools/call') return toolResponse(rpc, init)
    throw new Error(`Unexpected request: ${url}`)
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function start(id: string, actions = [search], settings: Partial<ChatRequest> = {}) {
  const key = `${id}-${host.scripts.size}`
  host.scripts.set(key, { actions, messages: [], round: 0 })
  await host.handlers.get('chat:send')!({}, {
    conversationId: id, messages: [{ role: 'user', content: key }],
    model: 'mlx-community/gemma-4-e4b-it-4bit', enableTools: true, mode: 'chat', ...settings
  })
  return { channel: `chat:stream:${id}`, script: host.scripts.get(key)! }
}
async function finish(run: Awaited<ReturnType<typeof start>>, timeout = 5_000) {
  await vi.waitFor(() => expect(host.events.some((e) => e.channel === run.channel &&
    (e.chunk.type === 'done' || e.chunk.type === 'error'))).toBe(true), { timeout })
  return host.events.filter((e) => e.channel === run.channel).map((e) => e.chunk)
}
const calls = () => requests.filter((r) => r.rpc?.method === 'tools/call').map((r) => r.rpc.params)

// Scripted model outputs exercise the production IPC handler, XML parser, tool
// resolver, real MCP SDK/HTTP transport and result fed into the next model round.
describe('Parallel through the agent loop', () => {
  test.each(['chat', 'code'] as const)('search and page excerpts reach the next %s round', async (mode) => {
    const run = await start(`happy-${mode}`, [search, fetchPage], { mode })
    const events = await finish(run)
    expect(calls().map((c) => c.name)).toEqual(['web_search', 'web_fetch'])
    expect(calls()[0].arguments).toMatchObject({
      objective: 'Gemma release notes', search_queries: ['Gemma release notes'],
      model_name: 'mlx-community/gemma-4-e4b-it-4bit'
    })
    expect(calls()[1].arguments.urls).toEqual([pageUrl])
    expect(run.script.messages[2].filter((m) => m.role === 'tool')).toHaveLength(2)
    expect(run.script.messages[2].at(-1).content).toContain(pageUrl)
    expect(events.some((e) => e.type === 'tool_result' && e.result?.includes('Useful page excerpts'))).toBe(true)
    expect(requests.some((r) => r.rpc?.method === 'tools/list')).toBe(true)
    for (const request of requests) {
      expect(request.url).toBe('https://search.parallel.ai/mcp')
      const headers = new Headers(request.init.headers)
      expect(headers.get('User-Agent')).toBe('Gemma-Chat/0.1.0 (+https://github.com/ammaarreshi/gemma-chat)')
      expect(headers.has('Authorization')).toBe(false)
    }
  })

  test('conversation IDs survive follow-ups and quota retries, and isolate interleaved/new chats', async () => {
    const a = await start('conversation-a', [search, fetchPage, search])
    const b = await start('conversation-b', [search, fetchPage])
    await Promise.all([finish(a), finish(b)])
    const initial = calls()
    const aId = initial[0].arguments.session_id
    const ids = new Set(initial.map((c) => c.arguments.session_id))
    expect(ids.size).toBe(2)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(initial.filter((c) => c.arguments.session_id === aId)).toHaveLength(3)
    expect(new Set(initial.filter((c) => c.name === 'web_fetch').map((c) => c.arguments.session_id))).toEqual(ids)
    host.events.length = 0
    toolResponse = (rpc) => json(rpc.id, { isError: true, content: [{ type: 'text', text: 'Anonymous quota reached' }] })
    await finish(await start('conversation-a'))
    expect(calls().at(-1).arguments.session_id).toBe(aId)
    host.events.length = 0
    await finish(await start('conversation-a'))
    expect(calls().at(-1).arguments.session_id).toBe(aId)
    host.events.length = 0
    await finish(await start('new-chat'))
    expect(ids.has(calls().at(-1).arguments.session_id)).toBe(false)
  })

  test.each(['tool', 'http', 'empty', 'malformed'])('%s errors reach the agent without fallback', async (kind) => {
    toolResponse = (rpc) => kind === 'http' ? new Response('Service unavailable', { status: 503 })
      : kind === 'malformed' ? new Response('not json', { headers: { 'Content-Type': 'application/json' } })
      : json(rpc.id, kind === 'tool' ? { isError: true, content: [{ type: 'text', text: 'quota reached' }] } : { content: [] })
    const run = await start(`error-${kind}`)
    await finish(run)
    expect(run.script.messages[1].at(-1).content).toContain('Error running web_search')
    expect(requests.every((r) => r.url === 'https://search.parallel.ai/mcp')).toBe(true)
  })

  test.each(['initialize', 'tools/list', 'missing-tool'])('%s failures do not dispatch or fall back', async (phase) => {
    const fixtureFetch = globalThis.fetch
    vi.stubGlobal('fetch', (input: URL | string, init: RequestInit = {}) => {
      const rpc = init.body ? JSON.parse(String(init.body)) : undefined
      if (rpc?.method === phase || (phase === 'missing-tool' && rpc?.method === 'tools/list')) {
        requests.push({ url: String(input), init, rpc })
        return phase === 'missing-tool' ? Promise.resolve(json(rpc.id, { tools: [] }))
          : Promise.resolve(new Response('Access denied', { status: 403 }))
      }
      return fixtureFetch(input, init)
    })
    const run = await start(`discovery-${phase}`)
    await finish(run)
    expect(calls()).toHaveLength(0)
    expect(run.script.messages[1].at(-1).content).toContain('Error running web_search')
    expect(requests.every((r) => r.url === 'https://search.parallel.ai/mcp')).toBe(true)
  })

  test('Stop aborts an in-flight MCP request and starts no further model round', async () => {
    toolResponse = (_rpc, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    })
    const run = await start('cancel')
    await vi.waitFor(() => expect(calls()).toHaveLength(1))
    await host.handlers.get('chat:abort')!({}, 'cancel')
    await finish(run)
    expect(requests.find((r) => r.rpc?.method === 'tools/call')!.init.signal!.aborted).toBe(true)
    expect(run.script.messages).toHaveLength(1)
  })

  test('the request deadline covers a stalled HTTP response', async () => {
    const timeout = new AbortController()
    const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    toolResponse = (_rpc, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    })
    const run = await start('timeout')
    await vi.waitFor(() => expect(calls()).toHaveLength(1))
    timeout.abort(new DOMException('Timed out', 'TimeoutError'))
    await finish(run)
    expect(timer).toHaveBeenCalledWith(20_000)
    expect(run.script.messages[1].at(-1).content).toContain('timed out after 20 seconds')
  })

  test('output stays bounded and preserves tool-visible source URLs', async () => {
    toolResponse = (rpc) => json(rpc.id, { content: [{ type: 'text', text: pageUrl + '\n' + 'x'.repeat(30_000) }] })
    const run = await start('bounded', [search, fetchPage])
    await finish(run)
    const toolResults = run.script.messages[2].filter((m) => m.role === 'tool')
    expect(toolResults[0].content.length).toBeLessThan(16_100)
    expect(toolResults[1].content.length).toBeLessThan(8_100)
    for (const result of toolResults) {
      expect(result.content).toContain(pageUrl)
      expect(result.content).toContain('[…truncated]')
    }
  })

  test('invalid query and URL make no network request', async () => {
    const run = await start('invalid', ['<action name="web_search"><query> </query></action>',
      '<action name="fetch_url"><url>file:///etc/passwd</url></action>'])
    await finish(run)
    expect(requests).toHaveLength(0)
    expect(run.script.messages[2].at(-1).content).toContain('url must be http(s)')
  })
})

describe('preserved user choices', () => {
  test.each([undefined, 'duckduckgo'])('provider %s retains DuckDuckGo and direct fetch', async (value) => {
    vi.stubEnv('GEMMA_SEARCH_PROVIDER', value)
    const fetch = vi.fn(async (input: URL | string) => new Response(String(input).startsWith('https://duckduckgo.com/')
      ? '<div class="result"><a class="result__a" href="https://example.com/">Example</a><a class="result__snippet">A useful result</a><div class="clear"'
      : '<html><body>Direct page content</body></html>'))
    vi.stubGlobal('fetch', fetch)
    const run = await start(`default-${value}`, [search, fetchPage])
    await finish(run)
    expect(String(fetch.mock.calls[0][0])).toBe('https://duckduckgo.com/html/?q=Gemma%20release%20notes')
    expect(String(fetch.mock.calls[1][0])).toBe(pageUrl)
    expect(run.script.messages[2].at(-1).content).toContain('Direct page content')
  })

  test('unknown explicit providers fail without switching to another service', async () => {
    vi.stubEnv('GEMMA_SEARCH_PROVIDER', 'invalid-provider')
    const run = await start('bad-provider')
    await finish(run)
    expect(requests).toHaveLength(0)
    expect(run.script.messages[1].at(-1).content).toContain('must be duckduckgo or parallel')
  })

  test('disabled Chat tools do not parse or execute model actions', async () => {
    const run = await start('disabled', [search], { enableTools: false })
    await finish(run)
    expect(requests).toHaveLength(0)
    expect(run.script.messages).toHaveLength(1)
    expect(host.events.some((e) => e.chunk.type === 'tool_call')).toBe(false)
  })
})

// Explicit opt-in smoke test: uses scripted model output, but the production
// tool dispatcher and SDK make real anonymous requests to the public endpoint.
test.skipIf(process.env.GEMMA_LIVE_SEARCH !== '1')('live anonymous agent tool path', async () => {
  vi.stubEnv('PARALLEL_API_KEY', undefined)
  const observed: RequestRecord[] = []
  const toolBodies: any[] = []
  vi.stubGlobal('fetch', async (input: URL | string, init: RequestInit = {}) => {
    const rpc = init.body ? JSON.parse(String(init.body)) : undefined
    observed.push({ url: String(input), init, rpc })
    const response = await realFetch(input, init)
    const body = await response.clone().text()
    if (rpc?.method === 'tools/call') {
      try { toolBodies.push(JSON.parse(body)) } catch { toolBodies.push(null) }
    }
    console.info(JSON.stringify({
      observedAt: new Date().toISOString(), url: String(input), method: init.method,
      userAgent: new Headers(init.headers).get('User-Agent'),
      hasAuthorization: new Headers(init.headers).has('Authorization'),
      request: rpc, status: response.status, headers: Object.fromEntries(response.headers),
      body
    }))
    return response
  })
  const run = await start('live-research', [search, '<action name="fetch_url"><url>https://example.com</url></action>'])
  const events = await finish(run, 60_000)
  const results = events.filter((e) => e.type === 'tool_result')
  console.info('LIVE_TOOL_RESULTS', JSON.stringify(results))
  expect(observed.some((r) => r.rpc?.method === 'tools/call')).toBe(true)
  for (const request of observed) {
    expect(request.url).toBe('https://search.parallel.ai/mcp')
    expect(new Headers(request.init.headers).has('Authorization')).toBe(false)
    expect(new Headers(request.init.headers).get('User-Agent')).toContain('Gemma-Chat/')
  }
  expect(results).toHaveLength(2)
  for (const result of results) {
    if (result.type !== 'tool_result') continue
    // Quotas are retained as an explicit outcome, never a successful search.
    if (result.result?.startsWith('Error')) {
      expect(result.result).toMatch(/quota|rate.limit|429/i)
      console.info('LIVE_OUTCOME: anonymous quota; no successful result claimed')
    } else {
      expect(result.result).toMatch(/https?:/)
      const index = results.indexOf(result)
      const payload = JSON.parse(toolBodies[index].result.content[0].text)
      expect(payload.results.length).toBeGreaterThan(0)
      console.info('LIVE_OUTCOME: useful result consumed by agent')
    }
  }
  expect(run.script.messages[2].filter((m) => m.role === 'tool')).toHaveLength(2)
}, 65_000)
