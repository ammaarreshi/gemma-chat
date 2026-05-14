export type SetupStage =
  | 'checking'
  | 'installing-mlx'
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

export interface ModelConfig {
  /** Primary/target model repo ID */
  model: string
  /** Optional draft model repo ID for speculative decoding */
  draftModel?: string
  /** Number of tokens to draft per speculative decoding round */
  numDraftTokens?: number
}

export interface DraftPairInfo {
  /** HuggingFace repo ID of the draft model */
  model: string
  /** Human-readable size string */
  size: string
  /** Size in bytes */
  sizeBytes: number
  /** Number of tokens to draft per round */
  numDraftTokens?: number
}

export interface ModelInfo {
  /** HuggingFace repo ID — used internally for mlx_lm */
  name: string
  /** Short, user-friendly display name */
  label: string
  size: string
  sizeBytes: number
  description: string
  recommended?: boolean
  /** Known compatible draft model for speculative decoding */
  draft?: DraftPairInfo
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    name: 'mlx-community/gemma-4-e2b-it-4bit',
    label: 'Gemma 4 E2B',
    size: '1.5 GB',
    sizeBytes: 1_500_000_000,
    description: 'Edge-sized. Fast & lightweight. Text + image + audio. Runs on 8GB+ Macs.',
    draft: {
      model: 'mlx-community/gemma-4-E2B-it-assistant-bf16',
      size: '1 GB',
      sizeBytes: 1_000_000_000,
      numDraftTokens: 6
    }
  },
  {
    name: 'mlx-community/gemma-4-e4b-it-4bit',
    label: 'Gemma 4 E4B',
    size: '3 GB',
    sizeBytes: 3_000_000_000,
    description: 'Best all-rounder. Text + image + audio. Runs on 8GB+ Macs.',
    recommended: true,
    draft: {
      model: 'mlx-community/gemma-4-E4B-it-assistant-bf16',
      size: '1 GB',
      sizeBytes: 1_000_000_000,
      numDraftTokens: 6
    }
  },
  {
    name: 'mlx-community/gemma-4-26b-a4b-it-4bit',
    label: 'Gemma 4 27B MoE',
    size: '16 GB',
    sizeBytes: 16_000_000_000,
    description: 'Mixture-of-Experts (26B, 4B active). 16GB+ RAM recommended.',
    draft: {
      model: 'mlx-community/gemma-4-26B-A4B-it-assistant-bf16',
      size: '1 GB',
      sizeBytes: 1_000_000_000,
      numDraftTokens: 4
    }
  },
  {
    name: 'mlx-community/gemma-4-31b-it-4bit',
    label: 'Gemma 4 31B',
    size: '18 GB',
    sizeBytes: 18_000_000_000,
    description: 'Frontier dense model. Best quality. 32GB+ RAM recommended.',
    draft: {
      model: 'mlx-community/gemma-4-31B-it-assistant-bf16',
      size: '1 GB',
      sizeBytes: 1_000_000_000,
      numDraftTokens: 6
    }
  }
]

export const DEFAULT_MODEL = 'mlx-community/gemma-4-e4b-it-4bit'

export function getModelInfo(name: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find((m) => m.name === name)
}

export function makeModelConfig(
  model: string,
  useDraft?: boolean
): ModelConfig {
  const info = getModelInfo(model)
  return {
    model,
    draftModel: useDraft && info?.draft ? info.draft.model : undefined,
    numDraftTokens: useDraft && info?.draft ? info.draft.numDraftTokens : undefined
  }
}

