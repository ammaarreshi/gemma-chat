import { app } from 'electron'
import { spawn, ChildProcess, spawnSync } from 'child_process'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const MLX_PORT = 11434
const MLX_HOST = `127.0.0.1:${MLX_PORT}`
const MLX_URL = `http://${MLX_HOST}`

let serverProc: ChildProcess | null = null
let currentModel: string | null = null

// ---------------------------------------------------------------------------
// Paths — everything lives under <appData>/mlx/
// ---------------------------------------------------------------------------

function dataDir(): string {
  return join(app.getPath('userData'), 'mlx')
}

function venvDir(): string {
  return join(dataDir(), 'venv')
}

/** The python binary inside our managed venv */
function venvPython(): string {
  return join(venvDir(), 'bin', 'python3')
}

function modelsDir(): string {
  return join(dataDir(), 'models')
}

// ---------------------------------------------------------------------------
// System Python detection
// ---------------------------------------------------------------------------

/**
 * Find a compatible system Python (3.10–3.13).
 * We explicitly skip 3.14+ because mlx-lm doesn't publish wheels for it yet.
 * We try versioned binaries first (most reliable), then fall back to `python3`.
 */
function findSystemPython(): string | null {
  // Prefer specific known-good versions, newest first
  const versionedCandidates = [
    '/opt/homebrew/bin/python3.13',
    '/opt/homebrew/bin/python3.12',
    '/opt/homebrew/bin/python3.11',
    '/opt/homebrew/bin/python3.10',
    '/opt/homebrew/opt/python@3.13/bin/python3.13',
    '/opt/homebrew/opt/python@3.12/bin/python3.12',
    '/opt/homebrew/opt/python@3.11/bin/python3.11',
    '/opt/homebrew/opt/python@3.10/bin/python3.10',
    '/usr/local/bin/python3.13',
    '/usr/local/bin/python3.12',
    '/usr/local/bin/python3.11',
    '/usr/local/bin/python3.10'
  ]

  for (const c of versionedCandidates) {
    try {
      const s = spawnSync(c, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      if (s.status === 0) {
        console.log(`[mlx] Found compatible Python: ${c} (${s.stdout.toString().trim()})`)
        return c
      }
    } catch {
      // not available
    }
  }

  // Last resort: try generic python3 but verify it's not 3.14+
  const fallbacks = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']
  for (const c of fallbacks) {
    try {
      const s = spawnSync(c, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      if (s.status === 0) {
        const ver = s.stdout.toString().trim() // e.g. "Python 3.13.2"
        const match = ver.match(/Python 3\.(\d+)/)
        const minor = match ? parseInt(match[1], 10) : 99
        if (minor >= 10 && minor <= 13) {
          console.log(`[mlx] Found compatible Python: ${c} (${ver})`)
          return c
        } else if (minor < 10) {
          console.log(`[mlx] Skipping ${c} — ${ver} is too old (need 3.10+)`)
        } else {
          console.log(`[mlx] Skipping ${c} — ${ver} is too new for mlx-lm`)
        }
      }
    } catch {
      // not available
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// MLX detection
// ---------------------------------------------------------------------------

export interface MLXStatus {
  /** Python to use for running mlx_lm (venv python if installed, system python otherwise) */
  python: string
  /** Whether mlx-lm is installed and importable */
  installed: boolean
}

/**
 * Check if mlx-lm is ready to use.
 * Returns the python path to use and whether mlx_lm is installed.
 */
export function locateMLX(): MLXStatus | null {
  // 1. Check if we have a working venv with mlx_lm and mlx_vlm installed
  const vPy = venvPython()
  if (existsSync(vPy)) {
    // Verify the venv Python is 3.10+ — older versions can't run modern mlx-lm
    try {
      const verCheck = spawnSync(vPy, ['--version'], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const verStr = verCheck.stdout?.toString().trim() || ''
      const verMatch = verStr.match(/Python 3\.(\d+)/)
      const minor = verMatch ? parseInt(verMatch[1], 10) : 0
      if (minor < 10) {
        console.log(`[mlx] Existing venv uses ${verStr} (too old). Deleting and recreating…`)
        try { rmSync(venvDir(), { recursive: true, force: true }) } catch { /* ok */ }
        // Fall through to system python detection below
      } else {
        // Venv Python is compatible — check if libraries are installed
        try {
          const check = spawnSync(vPy, ['-c', 'import mlx_lm, mlx_vlm; print("ok")'], {
            timeout: 15000,
            stdio: ['ignore', 'pipe', 'pipe']
          })
          const stdout = check.stdout?.toString().trim() || ''
          if (check.status === 0 && stdout.includes('ok')) {
            console.log('[mlx] Found MLX libraries in venv')
            return { python: vPy, installed: true }
          }
        } catch {
          // venv exists but libraries not importable
        }
        // Venv exists but libraries are missing — can still pip install into it
        return { python: vPy, installed: false }
      }
    } catch {
      // Can't check version — treat as needing recreation
      console.log('[mlx] Cannot determine venv Python version. Recreating…')
      try { rmSync(venvDir(), { recursive: true, force: true }) } catch { /* ok */ }
    }
  }

  // 2. No venv yet — find a compatible system python so we can create one
  const sysPython = findSystemPython()
  if (!sysPython) return null
  return { python: sysPython, installed: false }
}

// ---------------------------------------------------------------------------
// Installation — creates a venv and installs mlx-lm
// ---------------------------------------------------------------------------

export type InstallProgress = {
  stage: 'download' | 'install'
  message: string
}

/**
 * Install mlx-lm and mlx-vlm into a dedicated virtual environment.
 * Uses --index-url to bypass any corporate pip registries.
 * Returns the venv python path to use for all subsequent operations.
 */
export async function installMLX(
  onProgress: (p: InstallProgress) => void
): Promise<string> {
  const sysPython = findSystemPython()
  if (!sysPython) {
    throw new Error(
      'Python 3.10–3.13 not found. Please install Python via Homebrew: brew install python@3.13'
    )
  }

  const vDir = venvDir()
  const vPy = venvPython()

  // Step 1: Create venv if needed
  if (!existsSync(vPy)) {
    onProgress({ stage: 'install', message: 'Creating Python virtual environment…' })
    console.log(`[mlx] Creating venv at ${vDir} using ${sysPython}`)
    await runProcess(sysPython, ['-m', 'venv', vDir], onProgress)
  }

  // Step 2: Upgrade pip first (avoids old-pip issues)
  onProgress({ stage: 'install', message: 'Upgrading pip…' })
  await runProcess(vPy, [
    '-m', 'pip', 'install', '--upgrade', 'pip',
    '--index-url', 'https://pypi.org/simple/'
  ], onProgress)

  // Step 3: Install mlx-lm and mlx-vlm (force public PyPI to bypass corporate registries)
  onProgress({ stage: 'install', message: 'Installing MLX libraries (this may take a few minutes)…' })
  await runProcess(vPy, [
    '-m', 'pip', 'install', '--upgrade', 'mlx-lm>=0.31.0', 'mlx-vlm>=0.4.0',
    '--index-url', 'https://pypi.org/simple/'
  ], onProgress)

  // Verify the install worked
  const check = spawnSync(vPy, ['-c', 'import mlx_lm, mlx_vlm; print("ok")'], {
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (check.status !== 0 || !check.stdout?.toString().includes('ok')) {
    const err = check.stderr?.toString().slice(-300) || 'unknown error'
    throw new Error(`MLX libraries installed but failed to import: ${err}`)
  }

  console.log('[mlx] MLX libraries installed successfully')
  return vPy
}

/** Run a subprocess and stream output to onProgress */
function runProcess(
  cmd: string,
  args: string[],
  onProgress: (p: InstallProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        // Force public PyPI — don't inherit corporate pip.conf
        PIP_INDEX_URL: 'https://pypi.org/simple/',
        PIP_EXTRA_INDEX_URL: ''
      }
    })

    let stderr = ''
    proc.stdout?.on('data', (d) => {
      const line = d.toString().trim()
      if (line) onProgress({ stage: 'install', message: line.slice(0, 120) })
    })
    proc.stderr?.on('data', (d) => {
      stderr += d.toString()
      const line = d.toString().trim()
      if (line) onProgress({ stage: 'install', message: line.slice(0, 120) })
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed (exit ${code}): ${stderr.slice(-500)}`))
    })
  })
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export interface ServerProgress {
  message: string
  /** 0.0–1.0 progress fraction, if available */
  progress?: number
}

export async function startServer(
  python: string,
  model: string,
  onProgress?: (p: ServerProgress) => void
): Promise<void> {
  if (serverProc && !serverProc.killed && currentModel === model) return

  // Kill existing server if running with different model
  stopServer()

  const env = {
    ...process.env,
    // HuggingFace cache dir — keep models in our app data
    HF_HOME: modelsDir(),
    TRANSFORMERS_CACHE: modelsDir(),
    HF_HUB_DISABLE_TELEMETRY: '1'
  }

  // Track early exit so waitForHealth can bail out immediately
  let earlyExit: { code: number | null; stderr: string } | null = null
  let stderrBuf = ''

  // Use mlx_vlm for Gemma 4 models (they are multi-modal)
  const serverModule = model.includes('gemma-4') ? 'mlx_vlm.server' : 'mlx_lm.server'
  console.log(`[mlx] Starting server: ${python} -m ${serverModule} --model ${model} --port ${MLX_PORT}`)

  serverProc = spawn(
    python,
    ['-m', serverModule, '--model', model, '--port', String(MLX_PORT)],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    }
  )
  currentModel = model

  serverProc.stdout?.on('data', (d) => console.log('[mlx]', d.toString().trim()))
  serverProc.stderr?.on('data', (d) => {
    const text = d.toString()
    stderrBuf += text
    console.log('[mlx]', text.trim())

    // Parse HuggingFace download progress from stderr
    // Format: "Fetching 8 files:  50%|█████     | 4/8 [00:55<00:59, 14.98s/it]"
    if (onProgress) {
      const lines = text.split('\n')
      for (const line of lines) {
        // Match "Fetching N files: XX%" pattern
        const fetchMatch = line.match(/Fetching\s+(\d+)\s+files?:\s+(\d+)%.*?(\d+)\/(\d+)/)
        if (fetchMatch) {
          const pct = parseInt(fetchMatch[2], 10)
          const done = parseInt(fetchMatch[3], 10)
          const total = parseInt(fetchMatch[4], 10)
          onProgress({
            message: `Downloading model files… ${done}/${total}`,
            progress: pct / 100
          })
          continue
        }

        // Match loading messages
        if (line.includes('Starting httpd') || line.includes('starting') || line.includes('Started server process')) {
          onProgress({ message: 'Starting server…', progress: 1.0 })
        }
      }
    }
  })
  serverProc.on('exit', (code) => {
    console.log('[mlx] server exited with code', code)
    earlyExit = { code, stderr: stderrBuf }
    serverProc = null
    currentModel = null
  })

  // Wait for the server to become healthy.
  // First run downloads model weights from HuggingFace, so allow up to 10 min.
  await waitForHealth(600_000, () => earlyExit)
}

export function stopServer(): void {
  if (serverProc && !serverProc.killed) {
    console.log('[mlx] Stopping server')
    serverProc.kill('SIGTERM')
    serverProc = null
    currentModel = null
  }
}

/**
 * Poll the server's /v1/models endpoint until it responds.
 * If the server process exits early, throw immediately.
 */
async function waitForHealth(
  timeoutMs: number,
  checkEarlyExit: () => { code: number | null; stderr: string } | null
): Promise<void> {
  const start = Date.now()
  let lastError: unknown = null

  while (Date.now() - start < timeoutMs) {
    // Check if the server process crashed
    const exit = checkEarlyExit()
    if (exit) {
      throw new Error(
        `MLX server exited with code ${exit.code}. ${exit.stderr.slice(-500)}`
      )
    }

    try {
      const res = await fetch(`${MLX_URL}/v1/models`)
      if (res.ok) {
        console.log('[mlx] Server is healthy')
        return
      }
    } catch (e) {
      lastError = e
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`MLX server did not become healthy within ${timeoutMs / 1000}s: ${String(lastError)}`)
}

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

export async function listLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${MLX_URL}/v1/models`)
    if (!res.ok) return []
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => m.id)
  } catch {
    return []
  }
}

export async function hasModel(_name: string): Promise<boolean> {
  try {
    const models = await listLocalModels()
    return models.length > 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Chat streaming (OpenAI-compatible SSE)
// ---------------------------------------------------------------------------

export interface MLXChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: string[]
}

export interface MLXChatOptions {
  model: string
  messages: MLXChatMessage[]
  signal?: AbortSignal
  temperature?: number
}

export async function* chatStream(
  opts: MLXChatOptions
): AsyncGenerator<{ content?: string; done?: boolean }> {
  const res = await fetch(`${MLX_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages.map((m) => {
        if (m.images && m.images.length > 0) {
          const content: any[] = [{ type: 'text', text: m.content }]
          for (const img of m.images) {
            content.push({ type: 'image_url', image_url: { url: img } })
          }
          return { role: m.role, content }
        }
        return { role: m.role, content: m.content }
      }),
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

  // Parse SSE stream (OpenAI format: "data: {...}\n\n")
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

/** Parse an SSE byte stream into individual data payloads */
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

  // Flush remaining buffer
  if (buf.trim()) {
    for (const line of buf.trim().split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data) yield data
      }
    }
  }
}

export { MLX_URL }
