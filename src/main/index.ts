import { app, shell, BrowserWindow, ipcMain, nativeTheme, session, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  AVAILABLE_MODELS,
  OLLAMA_MODEL_PREFIX,
  modelProvider,
  runtimeModelName,
  type RuntimeProvider
} from '@shared/types'
import {
  locateMLX,
  installMLX,
  startServer,
  stopServer,
  chatStream,
  listLocalModels,
  type MLXChatMessage
} from './mlx'
import { ensureOllamaModel, listOllamaModels, ollamaChatStream } from './ollama'
import {
  TOOLS,
  chatSystemPrompt,
  codeSystemPrompt,
  findNextAction,
  emitSafeBoundary,
  runTool,
  cleanFileContent,
  type ToolContext
} from './tools'
import {
  ensureWorkspace,
  startWorkspaceServer,
  stopWorkspaceServer,
  getWorkspaceServerPort,
  previewUrl,
  listTree,
  workspaceDir,
  wsWriteFile
} from './workspace'
import type { ChatRequest, StreamChunk, ToolCall } from '../shared/types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e0e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (is.dev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

let activeProvider: RuntimeProvider | null = null

function modelLabel(model: string): string {
  return AVAILABLE_MODELS.find((m) => m.name === model)?.label ?? runtimeModelName(model)
}

async function ensureMLXRunning(model: string): Promise<string> {
  let mlx = locateMLX()
  if (!mlx) {
    if (process.platform === 'win32') {
      throw new Error('MLX is only available on Apple Silicon/macOS. Choose an Ollama model on Windows.')
    }
    throw new Error(
      'Python 3.10–3.13 not found. Install via Homebrew: brew install python@3.13'
    )
  }

  let pythonToUse = mlx.python

  if (!mlx.installed) {
    send('setup:status', {
      stage: 'installing-mlx',
      message: 'Installing MLX runtime…'
    })
    // installMLX creates the venv and returns the venv python path
    pythonToUse = await installMLX((p) => {
      send('setup:status', {
        stage: 'installing-mlx',
        message: p.message
      })
    })
  }

  const label = modelLabel(model)
  send('setup:status', { stage: 'starting-mlx', message: 'Starting model runtime…' })
  send('setup:status', {
    stage: 'downloading-model',
    message: `Loading ${label}… (first run downloads the model)`
  })
  await startServer(pythonToUse, model, (p) => {
    send('setup:status', {
      stage: 'downloading-model',
      message: p.message,
      progress: p.progress
    })
  })
  activeProvider = 'mlx'
  return pythonToUse
}

async function ensureOllamaRunning(model: string): Promise<void> {
  if (activeProvider === 'mlx') {
    stopServer()
  }

  const label = modelLabel(model)
  send('setup:status', {
    stage: 'connecting-ollama',
    message: `Connecting to Ollama for ${label}...`
  })
  await ensureOllamaModel(model)
  activeProvider = 'ollama'
}

async function ensureRuntimeRunning(model: string): Promise<void> {
  if (modelProvider(model) === 'ollama') {
    await ensureOllamaRunning(model)
    return
  }
  await ensureMLXRunning(model)
}

async function handleSetup(model: string): Promise<void> {
  try {
    send('setup:status', { stage: 'checking', message: 'Checking system…' })
    await ensureRuntimeRunning(model)
    send('setup:status', { stage: 'ready', message: 'Ready to chat.' })
  } catch (e) {
    send('setup:status', {
      stage: 'error',
      message: 'Setup failed',
      error: (e as Error).message
    })
  }
}

const MAX_TOOL_ROUNDS_CHAT = 6
const MAX_TOOL_ROUNDS_CODE = 40

function actionTarget(_name: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.path === 'string') return args.path
  if (typeof args.query === 'string') return String(args.query)
  if (typeof args.url === 'string') return String(args.url)
  if (typeof args.command === 'string')
    return String(args.command).slice(0, 80)
  return undefined
}

async function handleChat(req: ChatRequest, channel: string): Promise<void> {
  const abort = new AbortController()
  chatAbortControllers.set(req.conversationId, abort)

  const emit = (chunk: StreamChunk): void => send(channel, chunk)

  try {
    const baseMessages: MLXChatMessage[] = []

    if (req.mode === 'code') {
      const wsPath = await ensureWorkspace(req.conversationId)
      const href = previewUrl(req.conversationId)
      baseMessages.push({ role: 'system', content: codeSystemPrompt(wsPath, href) })
    } else {
      baseMessages.push({ role: 'system', content: chatSystemPrompt(req.enableTools) })
    }

    for (const m of req.messages) {
      baseMessages.push({ role: m.role as MLXChatMessage['role'], content: m.content })
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          if (tc.result != null) {
            baseMessages.push({
              role: 'tool',
              content: `Result of <action name="${tc.name}">: ${tc.result}`
            })
          }
        }
      }
    }

    const ctx: ToolContext = {
      conversationId: req.conversationId,
      onFileChange: () => send('workspace:changed', { conversationId: req.conversationId })
    }

    const useTools = req.mode === 'code' || req.enableTools
    const maxRounds = req.mode === 'code' ? MAX_TOOL_ROUNDS_CODE : MAX_TOOL_ROUNDS_CHAT

    emit({ type: 'activity', activity: { kind: 'thinking', chars: 0 } })

    for (let round = 0; round < maxRounds; round++) {
      let buffer = ''
      let emittedIdx = 0
      let firstToken = true
      let executedAction = false
      let lastActivityTs = 0
      let pendingAction: { name: string; target?: string } | null = null

      // Live-write state for write_file streaming
      let livePath: string | null = null
      let liveContentStart = -1
      let lastLiveWrite = 0
      let livePending: Promise<unknown> | null = null
      let lastEmittedContent = ''
      const writeLivePartial = (): void => {
        if (!livePath || liveContentStart < 0 || livePending) return
        let partial = buffer.slice(liveContentStart)
        if (partial.startsWith('\n')) partial = partial.slice(1)
        const closeIdx = partial.indexOf('</content>')
        if (closeIdx >= 0) partial = partial.slice(0, closeIdx)
        const cleaned = cleanFileContent(partial, livePath)
        if (cleaned !== lastEmittedContent) {
          lastEmittedContent = cleaned
          send('file:streaming', {
            conversationId: req.conversationId,
            path: livePath,
            content: cleaned,
            done: false
          })
        }
        livePending = wsWriteFile(req.conversationId, livePath, cleaned)
          .then(() => {
            send('workspace:changed', { conversationId: req.conversationId })
          })
          .catch(() => {
            /* tolerate partial write failures */
          })
          .finally(() => {
            livePending = null
          })
      }

      const emitActivity = (): void => {
        const now = Date.now()
        if (now - lastActivityTs < 400) return
        lastActivityTs = now
        if (pendingAction) {
          emit({
            type: 'activity',
            activity: {
              kind: 'tool',
              tool: pendingAction.name,
              target: pendingAction.target,
              chars: buffer.length
            }
          })
        } else {
          emit({ type: 'activity', activity: { kind: 'generating', chars: buffer.length } })
        }
      }

      const stream =
        modelProvider(req.model) === 'ollama'
          ? ollamaChatStream({
              model: req.model,
              messages: baseMessages,
              signal: abort.signal
            })
          : chatStream({
              model: req.model,
              messages: baseMessages,
              signal: abort.signal
            })

      streamLoop: for await (const chunk of stream) {
        if (chunk.content) {
          if (firstToken) {
            firstToken = false
            emit({ type: 'activity', activity: { kind: 'generating', chars: 0 } })
          }
          buffer += chunk.content

          // Forward raw token to devtools console for debugging
          mainWindow?.webContents.send('chat:raw', {
            conversationId: req.conversationId,
            chunk: chunk.content
          })

          // Detect if we've started an action (for activity label + live writes)
          if (!pendingAction) {
            const openMatch = buffer
              .slice(emittedIdx)
              .match(/<action\s+name\s*=\s*["']?([a-zA-Z_][\w]*)["']?\s*>/i)
            if (openMatch) {
              const name = openMatch[1]
              const rest = buffer.slice(emittedIdx + (openMatch.index ?? 0))
              const pathM = rest.match(/<path>([^<]+?)<\/path>/i)
              const urlM = rest.match(/<url>([^<]+?)<\/url>/i)
              const qM = rest.match(/<query>([^<]+?)<\/query>/i)
              const cmdM = rest.match(/<command>([^<\n]+)/i)
              pendingAction = {
                name,
                target: pathM?.[1] || urlM?.[1] || qM?.[1] || cmdM?.[1]
              }
            }
          } else if (!pendingAction.target) {
            const rest = buffer.slice(emittedIdx)
            const pathM = rest.match(/<path>([^<]+?)<\/path>/i)
            const urlM = rest.match(/<url>([^<]+?)<\/url>/i)
            const qM = rest.match(/<query>([^<]+?)<\/query>/i)
            const cmdM = rest.match(/<command>([^<\n]+)/i)
            const t = pathM?.[1] || urlM?.[1] || qM?.[1] || cmdM?.[1]
            if (t) pendingAction.target = t
          }

          // Live write_file streaming — create/update the file as <content> grows
          if (pendingAction?.name === 'write_file' && pendingAction.target && !livePath) {
            livePath = pendingAction.target
          }
          if (livePath && liveContentStart < 0) {
            const idx = buffer.indexOf('<content>')
            if (idx >= 0) liveContentStart = idx + '<content>'.length
          }
          if (livePath && liveContentStart >= 0) {
            const now = Date.now()
            if (now - lastLiveWrite > 450) {
              lastLiveWrite = now
              writeLivePartial()
            }
          }

          emitActivity()

          while (true) {
            if (!useTools) {
              // No tool parsing: stream tokens as they arrive
              if (emittedIdx < buffer.length) {
                emit({ type: 'token', text: buffer.slice(emittedIdx) })
                emittedIdx = buffer.length
              }
              break
            }

            const found = findNextAction(buffer, emittedIdx)

            if (found === null) {
              // No action starting in the remaining buffer: emit safe text
              const safe = emitSafeBoundary(buffer, emittedIdx)
              if (safe > emittedIdx) {
                emit({ type: 'token', text: buffer.slice(emittedIdx, safe) })
                emittedIdx = safe
              }
              break
            }

            if (found === 'incomplete') {
              // Action has started but not closed. Emit text up to the open tag.
              const openIdx = buffer.indexOf('<action', emittedIdx)
              if (openIdx > emittedIdx) {
                emit({ type: 'token', text: buffer.slice(emittedIdx, openIdx) })
                emittedIdx = openIdx
              }
              break
            }

            // Emit any text between last emit and action start
            if (found.start > emittedIdx) {
              emit({ type: 'token', text: buffer.slice(emittedIdx, found.start) })
            }
            emittedIdx = found.end

            const call: ToolCall = {
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: found.name,
              args: found.args,
              running: true
            }
            emit({ type: 'tool_call', call })
            emit({
              type: 'activity',
              activity: { kind: 'tool', tool: found.name, target: actionTarget(found.name, found.args) }
            })

            let result: string
            let hadError = false
            try {
              result = await runTool(found.name, found.args, ctx)
              emit({ type: 'tool_result', id: call.id, result })
            } catch (e) {
              result = `Error: ${(e as Error).message}`
              hadError = true
              emit({ type: 'tool_result', id: call.id, error: result })
            }

            baseMessages.push({ role: 'assistant', content: buffer.slice(0, emittedIdx) })
            baseMessages.push({
              role: 'tool',
              content: `[${hadError ? 'error' : 'ok'}] ${found.name}: ${result}`
            })
            executedAction = true
            if (livePath) {
              send('file:streaming', {
                conversationId: req.conversationId,
                path: livePath,
                content: lastEmittedContent,
                done: true
              })
            }
            pendingAction = null
            livePath = null
            liveContentStart = -1
            lastEmittedContent = ''
            emit({ type: 'activity', activity: { kind: 'thinking', chars: 0 } })
            // Break out of the current stream — we need to start a new
            // request with the updated conversation including the tool result.
            break streamLoop
          }
        }
        if (chunk.done) {
          break streamLoop
        }
      }

      if (!executedAction) {
        // In Build mode, if the model just described a plan without writing code,
        // nudge it to start coding immediately instead of ending the turn.
        if (req.mode === 'code' && round === 0 && buffer.trim().length > 0) {
          // Flush the plan text to the UI
          if (emittedIdx < buffer.length) {
            emit({ type: 'token', text: buffer.slice(emittedIdx) })
          }
          baseMessages.push({ role: 'assistant', content: buffer })
          baseMessages.push({
            role: 'user',
            content:
              'Good plan. Now start building — emit a write_file action with the first file immediately.'
          })
          emit({ type: 'activity', activity: { kind: 'thinking', chars: 0 } })
          continue // go to round 1
        }
        emit({ type: 'activity', activity: { kind: 'idle' } })
        emit({ type: 'done' })
        return
      }
    }
    emit({ type: 'activity', activity: { kind: 'idle' } })
    emit({
      type: 'error',
      error: `Reached max tool rounds (${maxRounds}). Ask the model to finish up and try again.`
    })
  } catch (e) {
    emit({ type: 'activity', activity: { kind: 'idle' } })
    if ((e as Error).name === 'AbortError') {
      emit({ type: 'done' })
    } else {
      emit({ type: 'error', error: (e as Error).message })
    }
  } finally {
    chatAbortControllers.delete(req.conversationId)
  }
}

const chatAbortControllers = new Map<string, AbortController>()

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ammaar.gemmachat')
  nativeTheme.themeSource = 'dark'

  // Set dock icon (macOS) — ensures the Gemma icon shows in dev mode
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await startWorkspaceServer()

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      callback(true)
      return
    }
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  ipcMain.handle('setup:start', async (_e, model: string) => {
    await handleSetup(model)
  })

  ipcMain.handle('model:switch', async (_e, model: string) => {
    const label = modelLabel(model)
    send('setup:status', {
      stage: modelProvider(model) === 'ollama' ? 'connecting-ollama' : 'downloading-model',
      message: `Switching to ${label}…`
    })
    try {
      await ensureRuntimeRunning(model)
      send('setup:status', { stage: 'ready', message: 'Ready to chat.' })
    } catch (e) {
      send('setup:status', {
        stage: 'error',
        message: 'Model switch failed',
        error: (e as Error).message
      })
    }
  })

  ipcMain.handle('setup:status', async () => {
    const mlx = locateMLX()
    const ollamaModels = await listOllamaModels()
    return { hasMLX: !!(mlx && mlx.installed), hasOllama: ollamaModels.length > 0 }
  })

  ipcMain.handle('models:list-local', async () => {
    const [mlxModels, ollamaModels] = await Promise.all([listLocalModels(), listOllamaModels()])
    return [
      ...mlxModels,
      ...ollamaModels.map((model) => `${OLLAMA_MODEL_PREFIX}${model}`)
    ]
  })

  ipcMain.handle('chat:send', async (_e, req: ChatRequest) => {
    const channel = `chat:stream:${req.conversationId}`
    handleChat(req, channel).catch((err) => console.error('chat handler error', err))
    return { channel }
  })

  ipcMain.handle('chat:abort', async (_e, conversationId: string) => {
    const c = chatAbortControllers.get(conversationId)
    if (c) c.abort()
  })

  ipcMain.handle('tools:list', async () => {
    return Object.values(TOOLS).map((t) => ({
      name: t.name,
      description: t.description,
      mode: t.mode
    }))
  })

  ipcMain.handle('workspace:info', async (_e, conversationId: string) => {
    await ensureWorkspace(conversationId)
    return {
      conversationId,
      path: workspaceDir(conversationId),
      previewUrl: previewUrl(conversationId)
    }
  })

  ipcMain.handle('workspace:list', async (_e, conversationId: string) => {
    const base = await ensureWorkspace(conversationId)
    return listTree(base, 300)
  })

  ipcMain.handle('workspace:open-external', async (_e, conversationId: string) => {
    await ensureWorkspace(conversationId)
    shell.openPath(workspaceDir(conversationId))
  })

  ipcMain.handle('workspace:server-port', async () => getWorkspaceServerPort())

  ipcMain.handle(
    'audio:transcribe',
    async (_e, { base64: _base64, model: _model }: { base64: string; model: string }) => {
      // Audio transcription via MLX is not yet supported
      // Return empty text so the UI doesn't break
      return { text: '' }
    }
  )

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep the app alive in the dock so reopening is instant and the
  // MLX subprocess + workspace server stay warm. Only non-darwin platforms
  // quit on last-window-close.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopServer()
  stopWorkspaceServer()
})
