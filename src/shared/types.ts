export type SetupStage =
  | 'checking'
  // Kept as 'starting-mlx' to preserve the IPC contract with the renderer's
  // StageList. Semantically this is now "warming Ollama model into memory".
  | 'starting-mlx'
  | 'downloading-model'
  | 'ready'
  | 'error'

export interface SetupStatus {
  stage: SetupStage
  message: string
  progress?: number
  bytesDone?: number
  bytesTotal?: number
  error?: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  error?: string
  running?: boolean
}

export type Role = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  toolCalls?: ToolCall[]
  createdAt: number
  model?: string
  done?: boolean
  activity?: AgentActivity
}

export type AgentMode = 'chat' | 'code'

export interface ChatRequest {
  conversationId: string
  messages: Array<{ role: Role; content: string; toolCalls?: ToolCall[] }>
  model: string
  enableTools: boolean
  mode: AgentMode
}

export interface WorkspaceInfo {
  conversationId: string
  path: string
  previewUrl: string
}

export interface WorkspaceFile {
  path: string
  kind: 'file' | 'dir'
  size?: number
}

export interface FileChangeEvent {
  conversationId: string
}

export type AgentActivity =
  | { kind: 'idle' }
  | { kind: 'thinking'; chars?: number }
  | { kind: 'generating'; chars?: number }
  | { kind: 'tool'; tool: string; target?: string; chars?: number }

export type StreamChunk =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; id: string; result?: string; error?: string }
  | { type: 'activity'; activity: AgentActivity }
  | { type: 'done' }
  | { type: 'error'; error: string }

export interface ModelInfo {
  /** Ollama model tag — used as the model identifier in API calls */
  name: string
  /** Short, user-friendly display name */
  label: string
  size: string
  sizeBytes: number
  description: string
  recommended?: boolean
}

// Ollama tags for Gemma 3. Sizes are the 4-bit quantized variants Ollama
// ships by default; check `ollama show <tag>` for current numbers.
export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    name: 'gemma3:1b',
    label: 'Gemma 3 1B',
    size: '815 MB',
    sizeBytes: 815_000_000,
    description: 'Tiny. Fast on any modern PC, even without a discrete GPU. Text only.'
  },
  {
    name: 'gemma3:4b',
    label: 'Gemma 3 4B',
    size: '3.3 GB',
    sizeBytes: 3_300_000_000,
    description: 'Best all-rounder. Text + vision. Runs on 8GB+ RAM.',
    recommended: true
  },
  {
    name: 'gemma3:12b',
    label: 'Gemma 3 12B',
    size: '8.1 GB',
    sizeBytes: 8_100_000_000,
    description: 'Stronger reasoning. Text + vision. 16GB+ RAM recommended.'
  },
  {
    name: 'gemma3:27b',
    label: 'Gemma 3 27B',
    size: '17 GB',
    sizeBytes: 17_000_000_000,
    description: 'Maximum quality. Text + vision. 32GB+ RAM (or a beefy GPU) recommended.'
  }
]

export const DEFAULT_MODEL = 'gemma3:4b'

