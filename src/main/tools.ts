import {
  wsWriteFile,
  wsReadFile,
  wsEditFile,
  wsDeleteFile,
  wsRunBash,
  ensureWorkspace,
  listTree,
  previewUrl
} from './workspace'

export interface ToolContext {
  conversationId: string
  onFileChange?: () => void
}

export interface ToolSpec {
  name: string
  description: string
  params: Array<{ name: string; description: string; required?: boolean; multiline?: boolean }>
  example: string
  mode: 'chat' | 'code' | 'both'
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function webSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) return 'Error: missing query'
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } })
  if (!res.ok) return `Search failed: ${res.status} ${res.statusText}`
  const html = await res.text()
  const results = parseDuckDuckGoResults(html).slice(0, 6)
  if (results.length === 0) return 'No results found.'
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join('\n\n')
}

function parseDuckDuckGoResults(
  html: string
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const blockRe = /<div class="result[^"]*?"[^>]*>([\s\S]*?)<div class="clear"/g
  const titleRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/

  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html))) {
    const block = m[1]
    const t = titleRe.exec(block)
    const s = snippetRe.exec(block)
    if (!t) continue
    const rawUrl = decodeURIComponent(t[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, ''))
      .split('&rut=')[0]
      .split('&amp;')[0]
    const cleanUrl = rawUrl.split('&')[0]
    const title = stripTags(t[2]).trim()
    const snippet = s ? stripTags(s[1]).trim() : ''
    if (title && cleanUrl.startsWith('http')) {
      results.push({ title, url: cleanUrl, snippet })
    }
    if (results.length >= 10) break
  }
  return results
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchUrl(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url ?? '').trim()
  if (!url) return 'Error: missing url'
  if (!/^https?:\/\//.test(url)) return 'Error: url must be http(s)'
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } })
    if (!res.ok) return `Fetch failed: ${res.status} ${res.statusText}`
    const ct = res.headers.get('content-type') || ''
    const text = await res.text()
    if (ct.includes('html')) {
      return htmlToText(text).slice(0, 8000)
    }
    return text.slice(0, 8000)
  } catch (e) {
    return `Error fetching: ${(e as Error).message}`
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

async function calc(args: Record<string, unknown>): Promise<string> {
  const expr = String(args.expression ?? '').trim()
  if (!expr) return 'Error: missing expression'
  if (!/^[0-9+\-*/().\s^%,eE]*$/.test(expr)) {
    return 'Error: only numeric expressions allowed'
  }
  try {
    const sanitized = expr.replace(/\^/g, '**')
    const result = Function(`"use strict"; return (${sanitized})`)()
    return String(result)
  } catch (e) {
    return `Error: ${(e as Error).message}`
  }
}

async function writeFile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const path = String(args.path ?? '').trim()
  const raw = typeof args.content === 'string' ? args.content : ''
  if (!path) return 'Error: missing <path>'
  const content = cleanFileContent(raw, path)
  await wsWriteFile(ctx.conversationId, path, content)
  ctx.onFileChange?.()
  const lines = content.split('\n').length
  return `Wrote ${path} (${content.length} bytes, ${lines} lines).`
}

export function cleanFileContent(raw: string, path: string): string {
  let s = raw

  // Case 1: fully wrapped in ```lang ... ```
  const full = s.trim().match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```[\s\S]*$/)
  if (full) {
    s = full[1]
  } else {
    // Case 2: just a leading fence ```lang\n
    const lead = s.match(/^\s*```[a-zA-Z0-9_-]*\n/)
    if (lead) {
      s = s.slice(lead[0].length)
      // If there's a trailing fence somewhere, cut everything from there
      const trail = s.search(/\n```(?:\s|$)/)
      if (trail >= 0) s = s.slice(0, trail)
    }
  }

  // Case 3: file-type-aware truncation of post-file commentary
  const lower = path.toLowerCase()
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const end = s.toLowerCase().lastIndexOf('</html>')
    if (end >= 0) s = s.slice(0, end + '</html>'.length) + '\n'
  } else if (lower.endsWith('.svg')) {
    const end = s.toLowerCase().lastIndexOf('</svg>')
    if (end >= 0) s = s.slice(0, end + '</svg>'.length) + '\n'
  } else if (lower.endsWith('.json')) {
    // Trim anything after a trailing } or ]
    const trimmed = s.trim()
    const lastBrace = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'))
    if (lastBrace >= 0) s = trimmed.slice(0, lastBrace + 1) + '\n'
  }

  return s
}

async function readFile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const path = String(args.path ?? '').trim()
  if (!path) return 'Error: missing <path>'
  try {
    const content = await wsReadFile(ctx.conversationId, path)
    if (content.length > 20_000) {
      return content.slice(0, 20_000) + '\n[…truncated]'
    }
    return content
  } catch (e) {
    return `Error reading ${path}: ${(e as Error).message}`
  }
}

async function editFile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const path = String(args.path ?? '').trim()
  const oldStr = typeof args.old_string === 'string' ? args.old_string : ''
  const newStr = typeof args.new_string === 'string' ? args.new_string : ''
  const replaceAll = args.replace_all === true || args.replace_all === 'true'
  if (!path) return 'Error: missing <path>'
  if (!oldStr) return 'Error: missing <old_string>'
  try {
    const r = await wsEditFile(ctx.conversationId, path, oldStr, newStr, replaceAll)
    ctx.onFileChange?.()
    return `Edited ${path} (${r.occurrences} replacement${r.occurrences === 1 ? '' : 's'}).`
  } catch (e) {
    return `Error editing ${path}: ${(e as Error).message}`
  }
}

async function listFiles(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const base = await ensureWorkspace(ctx.conversationId)
  const tree = await listTree(base, 200)
  if (tree.length === 0) return '(workspace is empty)'
  return tree
    .map((e) =>
      e.kind === 'dir' ? `${e.path}/` : `${e.path}${e.size != null ? ` (${e.size}B)` : ''}`
    )
    .join('\n')
}

async function deleteFile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const path = String(args.path ?? '').trim()
  if (!path) return 'Error: missing <path>'
  try {
    await wsDeleteFile(ctx.conversationId, path)
    ctx.onFileChange?.()
    return `Deleted ${path}.`
  } catch (e) {
    return `Error deleting ${path}: ${(e as Error).message}`
  }
}

async function runBash(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const command = String(args.command ?? '').trim()
  const timeout = typeof args.timeout_ms === 'number' ? args.timeout_ms : 60_000
  if (!command) return 'Error: missing <command>'
  try {
    const r = await wsRunBash(ctx.conversationId, command, timeout)
    ctx.onFileChange?.()
    const parts: string[] = []
    parts.push(`exit=${r.exitCode ?? 'killed'} (${r.durationMs}ms)`)
    if (r.stdout) parts.push('stdout:\n' + r.stdout)
    if (r.stderr) parts.push('stderr:\n' + r.stderr)
    if (r.truncated) parts.push('[output was truncated]')
    return parts.join('\n')
  } catch (e) {
    return `Error: ${(e as Error).message}`
  }
}

async function openPreview(_args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const url = previewUrl(ctx.conversationId)
  return `Preview is live at ${url}. The Canvas pane on the right shows it.`
}

export const TOOLS: Record<string, ToolSpec> = {
  web_search: {
    name: 'web_search',
    description: 'Search the web via DuckDuckGo. Returns a numbered list of results.',
    params: [{ name: 'query', description: 'what to search for', required: true }],
    example:
      '<action name="web_search">\n<query>latest tensorflow release notes</query>\n</action>',
    mode: 'both',
    run: webSearch
  },
  fetch_url: {
    name: 'fetch_url',
    description: 'Fetch a web page and return its text content (truncated to ~8KB).',
    params: [{ name: 'url', description: 'absolute http(s) URL', required: true }],
    example: '<action name="fetch_url">\n<url>https://example.com</url>\n</action>',
    mode: 'both',
    run: fetchUrl
  },
  calc: {
    name: 'calc',
    description: 'Evaluate a numeric expression.',
    params: [{ name: 'expression', description: 'math expression', required: true }],
    example: '<action name="calc">\n<expression>2 + 2 * 3</expression>\n</action>',
    mode: 'both',
    run: calc
  },
  write_file: {
    name: 'write_file',
    description:
      'Create or overwrite a file in the workspace. Use this to generate code, HTML, CSS, JSON, etc.',
    params: [
      { name: 'path', description: 'path relative to workspace (e.g. index.html)', required: true },
      { name: 'content', description: 'full file text', required: true, multiline: true }
    ],
    example:
      '<action name="write_file">\n<path>index.html</path>\n<content>\n<!doctype html>\n<html>\n<body>Hello</body>\n</html>\n</content>\n</action>',
    mode: 'code',
    run: writeFile
  },
  read_file: {
    name: 'read_file',
    description: 'Read a file from the workspace.',
    params: [{ name: 'path', description: 'path relative to workspace', required: true }],
    example: '<action name="read_file">\n<path>index.html</path>\n</action>',
    mode: 'code',
    run: readFile
  },
  edit_file: {
    name: 'edit_file',
    description:
      'Replace a snippet in an existing file. old_string must appear exactly once, or pass <replace_all>true</replace_all>.',
    params: [
      { name: 'path', description: 'file path', required: true },
      { name: 'old_string', description: 'exact text to find', required: true, multiline: true },
      { name: 'new_string', description: 'replacement text', required: true, multiline: true },
      { name: 'replace_all', description: 'true to replace every occurrence' }
    ],
    example:
      '<action name="edit_file">\n<path>index.html</path>\n<old_string>Hello</old_string>\n<new_string>Hello, world</new_string>\n</action>',
    mode: 'code',
    run: editFile
  },
  list_files: {
    name: 'list_files',
    description: 'List every file in the workspace.',
    params: [],
    example: '<action name="list_files"></action>',
    mode: 'code',
    run: listFiles
  },
  delete_file: {
    name: 'delete_file',
    description: 'Delete a file or directory from the workspace.',
    params: [{ name: 'path', description: 'path to delete', required: true }],
    example: '<action name="delete_file">\n<path>old.html</path>\n</action>',
    mode: 'code',
    run: deleteFile
  },
  run_bash: {
    name: 'run_bash',
    description:
      'Run a bash command inside the workspace directory. Use for npm install, git, formatters, quick checks.',
    params: [
      { name: 'command', description: 'shell command', required: true, multiline: true }
    ],
    example: '<action name="run_bash">\n<command>ls -la</command>\n</action>',
    mode: 'code',
    run: runBash
  },
  open_preview: {
    name: 'open_preview',
    description:
      'Reveal the Canvas preview. Call after creating or updating index.html so the user sees the result.',
    params: [],
    example: '<action name="open_preview"></action>',
    mode: 'code',
    run: openPreview
  }
}

function tz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

function renderToolHelp(mode: 'chat' | 'code'): string {
  const wanted = (t: ToolSpec): boolean => t.mode === 'both' || t.mode === mode
  const lines: string[] = []
  for (const t of Object.values(TOOLS)) {
    if (!wanted(t)) continue
    lines.push(`### ${t.name}`)
    lines.push(t.description)
    if (t.params.length) {
      lines.push('Parameters:')
      for (const p of t.params) {
        const req = p.required ? ' (required)' : ''
        const multi = p.multiline ? ' — multi-line OK' : ''
        lines.push(`  <${p.name}>: ${p.description}${req}${multi}`)
      }
    } else {
      lines.push('No parameters.')
    }
    lines.push('Example:')
    lines.push(t.example)
    lines.push('')
  }
  return lines.join('\n')
}

export function chatSystemPrompt(enableTools: boolean): string {
  const now = new Date().toISOString()
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  if (!enableTools) {
    return [
      "You are Gemma, an AI assistant running 100% locally on the user's Mac.",
      `Current date/time: ${now} (${day}). Timezone: ${tz()}.`,
      'Be clear, concise, and helpful. Use markdown for formatting when useful.'
    ].join('\n')
  }
  return [
    "You are Gemma, an AI assistant running 100% locally on the user's Mac.",
    `Current date/time: ${now} (${day}). Timezone: ${tz()}.`,
    '',
    'TOOL USE',
    '========',
    'When a tool helps, emit ONE action block and STOP. You will receive the result, then you may continue or call another tool.',
    '',
    'Action format:',
    '<action name="tool_name">',
    '<param_name>value</param_name>',
    '</action>',
    '',
    'Rules:',
    '- One action per response, on its own line.',
    '- Never wrap actions in markdown code fences.',
    '- After writing </action>, STOP. Wait for the result before continuing.',
    '- When finished, write a short plain-text answer and emit no more actions.',
    '',
    'Tools:',
    '',
    renderToolHelp('chat')
  ].join('\n')
}

export function piAiChatSystemPrompt(enableTools: boolean): string {
  const now = new Date().toISOString()
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  if (!enableTools) {
    return [
      'You are an AI assistant in Gemma Chat.',
      `Current date/time: ${now} (${day}). Timezone: ${tz()}.`,
      'Be clear, concise, and helpful. Use markdown for formatting when useful.'
    ].join('\n')
  }
  return [
    'You are an AI assistant in Gemma Chat.',
    `Current date/time: ${now} (${day}). Timezone: ${tz()}.`,
    '',
    'TOOL USE',
    '========',
    'When a tool helps, emit ONE action block and STOP. You will receive the result, then you may continue or call another tool.',
    '',
    'Action format:',
    '<action name="tool_name">',
    '<param_name>value</param_name>',
    '</action>',
    '',
    'Rules:',
    '- One action per response, on its own line.',
    '- Never wrap actions in markdown code fences.',
    '- After writing </action>, STOP. Wait for the result before continuing.',
    '- When finished, write a short plain-text answer and emit no more actions.',
    '',
    'Tools:',
    '',
    renderToolHelp('chat')
  ].join('\n')
}

export function codeSystemPrompt(workspacePath: string, previewHref: string): string {
  const now = new Date().toISOString()
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' })
  return [
    "You are Gemma, a local coding agent running entirely on the user's Mac.",
    `Date: ${now} (${day}). Workspace: ${workspacePath}. Preview: ${previewHref}`,
    '',
    'WHAT TO BUILD',
    'You build small apps, pages, demos, and scripts. Quality matters — the user is watching.',
    '- Modern, polished design by default: clean typography, generous whitespace, subtle gradients, rounded corners, smooth transitions. Dark-mode-friendly when it fits.',
    '- Real-feeling copy, not lorem ipsum. Invent brand names and details.',
    '- Make it actually work: click handlers wired, animations smooth, forms usable.',
    '- Fetch real images only when asked; otherwise use CSS/SVG for illustrations.',
    '',
    'FILE STRUCTURE — PREFER MULTI-FILE FOR ANYTHING NON-TRIVIAL',
    '- One-off widgets / tiny demos → single `index.html` with <style> + <script> inline.',
    '- Landing pages, apps with state, anything > ~200 lines → split into:',
    '    `index.html` — structure + <link rel="stylesheet" href="style.css"> + <script src="app.js" defer></script>',
    '    `style.css`  — all styling',
    '    `app.js`     — all behavior',
    '- Multi-file is easier to read, edit later, and shows off modular thinking. Emit a separate write_file action for each file.',
    '',
    'HOW YOU WORK',
    '1. Start with ONE sentence describing your plan (e.g., "I\'ll split this into index.html, style.css, and app.js."). Then IMMEDIATELY emit your first write_file action in the SAME response. Do NOT stop after planning — start building right away.',
    '2. After each action, STOP and wait for the result. In subsequent turns, one sentence of narration (e.g., "Now the stylesheet."), then the action, then STOP.',
    '3. After all files are written, call `open_preview`, then write a one-sentence plain-text summary. Emit no further actions.',
    '',
    'CRITICAL: You MUST emit a write_file action in your VERY FIRST response. Never respond with only a plan or description. Always start coding immediately.',
    '',
    'ACTION FORMAT — EXACT',
    '<action name="tool_name">',
    '<param_name>value</param_name>',
    '</action>',
    '',
    '<content> RULES — READ TWICE',
    'The string between <content> and </content> is WRITTEN TO DISK LITERALLY. Everything is saved.',
    '- NEVER put ``` fences at the start or end of <content>. Not ``` alone, not ```html, not ```js. None.',
    '- NEVER put explanatory text, "Key Features", "Instructions to Use", or any commentary INSIDE <content>. Only the file contents.',
    '- Close <content> with </content> on its own line, immediately after the last line of the file.',
    '- Then close the action with </action> on its own line.',
    '',
    'EXAMPLE — multi-file build (FIRST response)',
    '',
    "I'll split this into three files: index.html for structure, style.css for the design, and app.js for the countdown behavior. Starting with the HTML shell.",
    '',
    '<action name="write_file">',
    '<path>index.html</path>',
    '<content>',
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Coming Soon</title>',
    '<link rel="stylesheet" href="style.css">',
    '<script src="app.js" defer></script>',
    '</head>',
    '<body><main><h1>Coming soon</h1></main></body>',
    '</html>',
    '</content>',
    '</action>',
    '',
    'HARD RULES',
    '- ALWAYS start coding in your first response. Never reply with only a plan.',
    '- Never paste file contents in your chat reply — only inside <content>.',
    '- Never wrap <action> tags in ``` code fences.',
    '- Paths are relative to the workspace (no leading slashes).',
    '- One action per response, then STOP and wait.',
    '',
    'AVAILABLE TOOLS',
    '',
    renderToolHelp('code')
  ].join('\n')
}

export function piAiCodeSystemPrompt(workspacePath: string, previewHref: string): string {
  const localPrompt = codeSystemPrompt(workspacePath, previewHref)
  return localPrompt.replace(
    "You are Gemma, a local coding agent running entirely on the user's Mac.",
    'You are an AI coding agent in Gemma Chat.'
  )
}

export interface ParsedAction {
  name: string
  args: Record<string, unknown>
  raw: string
  start: number
  end: number
}

export function findNextAction(text: string, from = 0): ParsedAction | 'incomplete' | null {
  // Accept variations: <action name="x">, name='x', name=x, case-insensitive
  const openRe = /<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*>/gi
  openRe.lastIndex = from
  const open = openRe.exec(text)
  if (!open) return null
  const name = open[1]
  const bodyStart = open.index + open[0].length
  const closeMatch = text.slice(bodyStart).match(/<\/action\s*>/i)
  if (!closeMatch || closeMatch.index === undefined) return 'incomplete'
  const closeIdx = bodyStart + closeMatch.index
  const body = text.slice(bodyStart, closeIdx)
  const args = parseActionBody(body)
  return {
    name,
    args,
    raw: text.slice(open.index, closeIdx + closeMatch[0].length),
    start: open.index,
    end: closeIdx + closeMatch[0].length
  }
}

function parseActionBody(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {}

  // Special-case <content>…</content> — use the LAST </content> to survive nested close-tags
  const contentOpen = body.indexOf('<content>')
  let outside = body
  if (contentOpen >= 0) {
    const contentCloseRel = body.lastIndexOf('</content>')
    if (contentCloseRel > contentOpen) {
      let content = body.slice(contentOpen + '<content>'.length, contentCloseRel)
      content = content.replace(/^\n/, '')
      content = content.replace(/\n[ \t]*$/, '')
      args.content = content
      outside = body.slice(0, contentOpen) + body.slice(contentCloseRel + '</content>'.length)
    }
  }

  const tagRe = /<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(outside)) !== null) {
    const key = m[1]
    if (key === 'content') continue
    const raw = m[2]
    const trimmed = raw.trim()
    if (trimmed === 'true') args[key] = true
    else if (trimmed === 'false') args[key] = false
    else if (/^-?\d+$/.test(trimmed)) args[key] = Number(trimmed)
    else args[key] = raw.replace(/^\n/, '').replace(/\n[ \t]*$/, '')
  }
  return args
}

export function emitSafeBoundary(buffer: string, from: number): number {
  // Return the largest index ≤ buffer.length such that the slice [from, idx)
  // cannot be the start of a forming <action ...> tag.
  // Scan backwards from the end for a '<' that could start "<action".
  for (let i = buffer.length - 1; i >= from; i--) {
    if (buffer[i] !== '<') continue
    const tail = buffer.slice(i).toLowerCase()
    // Could this be the start of "<action"? If tail is shorter than "<action"
    // we can't be sure yet — hold back.
    if (tail.length < 8) {
      if ('<action'.startsWith(tail)) return i
      continue
    }
    if (tail.startsWith('<action') && /\s/.test(tail[7])) return i
    // Otherwise this '<' is some other tag — safe.
  }
  return buffer.length
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const tool = TOOLS[name]
  if (!tool) return `Error: unknown tool "${name}". Available: ${Object.keys(TOOLS).join(', ')}`
  try {
    return await tool.run(args, ctx)
  } catch (e) {
    return `Error running ${name}: ${(e as Error).message}`
  }
}
