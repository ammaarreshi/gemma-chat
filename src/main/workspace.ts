import { app } from 'electron'
import { createServer, type Server } from 'http'
import { createReadStream, existsSync } from 'fs'
import { mkdir, readFile, writeFile, readdir, stat, access, rm, rename } from 'fs/promises'
import { join, resolve, dirname, extname, relative, sep, delimiter } from 'path'
import { spawn } from 'child_process'

let server: Server | null = null
let serverPort = 0

export function workspacesRoot(): string {
  return join(app.getPath('userData'), 'workspaces')
}

export function workspaceDir(conversationId: string): string {
  return join(workspacesRoot(), sanitizeId(conversationId))
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'default'
}

export async function ensureWorkspace(conversationId: string): Promise<string> {
  const dir = workspaceDir(conversationId)
  await mkdir(dir, { recursive: true })
  return dir
}

export function assertInWorkspace(base: string, target: string): string {
  const resolved = resolve(base, target)
  const rel = relative(base, resolved)
  if (rel.startsWith('..') || rel.startsWith('/') || rel.includes('..' + sep)) {
    throw new Error(`Path escapes workspace: ${target}`)
  }
  return resolved
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.tsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export async function startWorkspaceServer(): Promise<number> {
  if (server) return serverPort
  await mkdir(workspacesRoot(), { recursive: true })

  server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin
      res.setHeader('Access-Control-Allow-Origin', origin ?? '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'content-type')
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
      res.setHeader('Pragma', 'no-cache')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url ?? '/', `http://localhost`)
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length === 0) {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('gemma-chat workspace server')
        return
      }
      const id = parts[0]
      const root = workspaceDir(id)
      const rel = parts.slice(1).join('/') || ''
      let target: string
      try {
        target = assertInWorkspace(root, rel)
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('Bad path')
        return
      }

      let s
      try {
        s = await stat(target)
      } catch {
        // Maybe it's a root with no index yet — render placeholder
        if (rel === '' || rel === '/') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(renderPlaceholder(id))
          return
        }
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('Not found')
        return
      }

      if (s.isDirectory()) {
        const indexPath = join(target, 'index.html')
        try {
          await access(indexPath)
          const body = await readFile(indexPath)
          res.writeHead(200, { 'content-type': MIME['.html'] })
          res.end(body)
          return
        } catch {
          // directory listing
          const entries = await readdir(target, { withFileTypes: true })
          const files = entries.map((e) => ({
            name: e.name,
            kind: e.isDirectory() ? 'dir' : 'file'
          }))
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(renderDirList(id, rel, files))
          return
        }
      }

      const ext = extname(target).toLowerCase()
      const mime = MIME[ext] ?? 'application/octet-stream'
      res.writeHead(200, {
        'content-type': mime,
        'content-length': s.size
      })
      createReadStream(target).pipe(res)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end((e as Error).message)
    }
  })

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  if (addr && typeof addr !== 'string') {
    serverPort = addr.port
  }
  return serverPort
}

export function stopWorkspaceServer(): void {
  if (server) {
    server.close()
    server = null
    serverPort = 0
  }
}

export function getWorkspaceServerPort(): number {
  return serverPort
}

export function previewUrl(conversationId: string): string {
  return `http://127.0.0.1:${serverPort}/${sanitizeId(conversationId)}/`
}

function renderPlaceholder(_id: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Preview</title>
<style>
  html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#0e0e0e;color:#888;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}
  .box{max-width:360px;padding:28px;text-align:center}
  .ico{width:44px;height:44px;margin:0 auto 14px;opacity:.35}
  .title{color:#e8e8e8;font-weight:500;margin-bottom:6px}
</style></head><body>
<div class="box">
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h10l6 6v10H4z"/><path d="M14 4v6h6"/></svg>
  <div class="title">No preview yet</div>
  <div>Ask Gemma to create <code style="color:#bbb">index.html</code> to see it here.</div>
</div>
</body></html>`
}

function renderDirList(
  id: string,
  rel: string,
  files: Array<{ name: string; kind: string }>
): string {
  const rows = files
    .map(
      (f) =>
        `<li><a href="/${id}/${rel}${rel ? '/' : ''}${f.name}">${escapeHtml(f.name)}</a> <span class="k">${f.kind}</span></li>`
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(rel || id)}</title>
<style>
  body{margin:0;padding:24px 28px;background:#0e0e0e;color:#e8e8e8;font:13.5px/1.6 -apple-system,BlinkMacSystemFont,sans-serif}
  h1{font-size:13px;color:#888;font-weight:500;margin:0 0 12px;text-transform:uppercase;letter-spacing:.08em}
  ul{list-style:none;padding:0;margin:0}
  li{padding:6px 0;border-bottom:1px solid #1a1a1a}
  a{color:#e8e8e8;text-decoration:none}
  a:hover{color:#7aa2f7}
  .k{color:#555;font-size:11px;margin-left:8px}
</style></head><body>
<h1>/${escapeHtml(rel || '')}</h1>
<ul>${rows}</ul>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface FileEntry {
  path: string
  kind: 'file' | 'dir'
  size?: number
}

export async function listTree(base: string, max = 200): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  async function walk(dir: string, prefix: string): Promise<void> {
    if (out.length >= max) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (e.name === 'node_modules') continue
      const p = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) {
        out.push({ path: p, kind: 'dir' })
        await walk(join(dir, e.name), p)
      } else {
        try {
          const s = await stat(join(dir, e.name))
          out.push({ path: p, kind: 'file', size: s.size })
        } catch {
          out.push({ path: p, kind: 'file' })
        }
      }
      if (out.length >= max) return
    }
  }
  await walk(base, '')
  return out
}

export async function wsWriteFile(
  conversationId: string,
  path: string,
  content: string
): Promise<string> {
  const base = await ensureWorkspace(conversationId)
  const target = assertInWorkspace(base, path)
  await mkdir(dirname(target), { recursive: true })
  const tmp = target + '.tmp-' + Date.now()
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, target)
  return target
}

export async function wsReadFile(conversationId: string, path: string): Promise<string> {
  const base = await ensureWorkspace(conversationId)
  const target = assertInWorkspace(base, path)
  return readFile(target, 'utf-8')
}

export async function wsEditFile(
  conversationId: string,
  path: string,
  oldString: string,
  newString: string,
  replaceAll = false
): Promise<{ occurrences: number }> {
  const content = await wsReadFile(conversationId, path)
  if (replaceAll) {
    const parts = content.split(oldString)
    if (parts.length === 1) throw new Error(`old_string not found in ${path}`)
    const next = parts.join(newString)
    await wsWriteFile(conversationId, path, next)
    return { occurrences: parts.length - 1 }
  }
  const idx = content.indexOf(oldString)
  if (idx < 0) throw new Error(`old_string not found in ${path}`)
  const second = content.indexOf(oldString, idx + oldString.length)
  if (second >= 0) {
    throw new Error(`old_string appears multiple times in ${path}. Use replace_all or add context.`)
  }
  const next = content.slice(0, idx) + newString + content.slice(idx + oldString.length)
  await wsWriteFile(conversationId, path, next)
  return { occurrences: 1 }
}

export async function wsDeleteFile(conversationId: string, path: string): Promise<void> {
  const base = await ensureWorkspace(conversationId)
  const target = assertInWorkspace(base, path)
  await rm(target, { recursive: true, force: true })
}

export interface BashResult {
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  durationMs: number
}

const BASH_DENY =
  /\b(rm\s+-rf\s+\/|sudo|:\(\)\s*\{|chmod\s+777\s+\/|mkfs|dd\s+if=|shutdown|reboot)/i

let bashPathCache: string | null = null

function findOnPath(command: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, command)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveBash(): string {
  if (bashPathCache) return bashPathCache
  if (process.platform !== 'win32') {
    bashPathCache = '/bin/bash'
    return bashPathCache
  }

  const candidates = [
    process.env.GIT_BASH,
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    findOnPath('bash.exe'),
    findOnPath('bash')
  ].filter((candidate): candidate is string => !!candidate)

  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error('Bash is required for run_bash. Install Git for Windows or add bash.exe to PATH.')
  }
  bashPathCache = found
  return bashPathCache
}

export async function wsRunBash(
  conversationId: string,
  command: string,
  timeoutMs = 60_000,
  maxBytes = 16_000
): Promise<BashResult> {
  if (BASH_DENY.test(command)) {
    throw new Error('Blocked by safety policy: command contains a denied pattern.')
  }
  const base = await ensureWorkspace(conversationId)
  const start = Date.now()

  return new Promise((resolve) => {
    const proc = spawn(resolveBash(), ['-lc', command], {
      cwd: base,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    })
    let stdout = ''
    let stderr = ''
    let truncated = false
    const killTimer = setTimeout(() => {
      proc.kill('SIGKILL')
      truncated = true
    }, timeoutMs)

    proc.stdout.on('data', (d: Buffer) => {
      if (stdout.length < maxBytes) {
        stdout += d.toString('utf-8')
        if (stdout.length >= maxBytes) {
          stdout = stdout.slice(0, maxBytes) + '\n[…output truncated]'
          truncated = true
        }
      }
    })
    proc.stderr.on('data', (d: Buffer) => {
      if (stderr.length < maxBytes) {
        stderr += d.toString('utf-8')
        if (stderr.length >= maxBytes) {
          stderr = stderr.slice(0, maxBytes) + '\n[…stderr truncated]'
          truncated = true
        }
      }
    })
    proc.on('close', (code) => {
      clearTimeout(killTimer)
      resolve({
        exitCode: code,
        stdout,
        stderr,
        truncated,
        durationMs: Date.now() - start
      })
    })
    proc.on('error', (e) => {
      clearTimeout(killTimer)
      resolve({
        exitCode: -1,
        stdout,
        stderr: (stderr + '\n' + String(e)).trim(),
        truncated,
        durationMs: Date.now() - start
      })
    })
  })
}
