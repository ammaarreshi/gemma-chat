export type SetupStage =
  | 'checking'
  | 'installing-mlx'
  | 'starting-mlx'
  | 'connecting-ollama'
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
  /** Runtime that serves this model */
  provider: RuntimeProvider
  /** Runtime-specific model ID. MLX uses HuggingFace repo IDs; Ollama uses local model tags. */
  name: string
  /** Short, user-friendly display name */
  label: string
  size: string
  sizeBytes: number
  description: string
  recommended?: boolean
}

export type RuntimeProvider = 'mlx' | 'ollama'

export const OLLAMA_MODEL_PREFIX = 'ollama:'

export function modelProvider(model: string): RuntimeProvider {
  return model.startsWith(OLLAMA_MODEL_PREFIX) ? 'ollama' : 'mlx'
}

export function runtimeModelName(model: string): string {
  return model.startsWith(OLLAMA_MODEL_PREFIX) ? model.slice(OLLAMA_MODEL_PREFIX.length) : model
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    provider: 'mlx',
    name: 'mlx-community/gemma-4-e2b-it-4bit',
    label: 'Gemma 4 E2B',
    size: '1.5 GB',
    sizeBytes: 1_500_000_000,
    description: 'Edge-sized. Fast & lightweight. Text + image + audio. Runs on 8GB+ Macs.'
  },
  {
    provider: 'mlx',
    name: 'mlx-community/gemma-4-e4b-it-4bit',
    label: 'Gemma 4 E4B',
    size: '3 GB',
    sizeBytes: 3_000_000_000,
    description: 'Best all-rounder. Text + image + audio. Runs on 8GB+ Macs.',
    recommended: true
  },
  {
    provider: 'mlx',
    name: 'mlx-community/gemma-4-26b-a4b-it-4bit',
    label: 'Gemma 4 27B MoE',
    size: '16 GB',
    sizeBytes: 16_000_000_000,
    description: 'Mixture-of-Experts (26B, 4B active). 16GB+ RAM recommended.'
  },
  {
    provider: 'mlx',
    name: 'mlx-community/gemma-4-31b-it-4bit',
    label: 'Gemma 4 31B',
    size: '18 GB',
    sizeBytes: 18_000_000_000,
    description: 'Frontier dense model. Best quality. 32GB+ RAM recommended.'
  },
  {
    provider: 'ollama',
    name: 'ollama:gemma3:4b',
    label: 'Gemma 3 4B',
    size: 'Ollama',
    sizeBytes: 0,
    description: 'Use a locally pulled Ollama model. Requires Ollama running with gemma3:4b.'
  },
  {
    provider: 'ollama',
    name: 'ollama:llama3.2',
    label: 'Llama 3.2',
    size: 'Ollama',
    sizeBytes: 0,
    description: 'Use a locally pulled Ollama model. Requires Ollama running with llama3.2.'
  }
]

export const DEFAULT_MODEL = 'mlx-community/gemma-4-e4b-it-4bit'
