export type SetupStage =
  | 'checking'
  | 'installing-mlx'
  | 'starting-mlx'
  | 'connecting-lm-studio'
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

export type RuntimeProvider = 'mlx' | 'lm-studio'

export interface RuntimeConfig {
  provider: RuntimeProvider
  /** Runtime-specific model id passed to the backend. */
  model: string
  /** Gemma model selection this runtime model represents. */
  appModel?: string
  endpoint?: string
}

export interface ChatRequest {
  conversationId: string
  messages: Array<{ role: Role; content: string; toolCalls?: ToolCall[] }>
  model: string
  runtime?: RuntimeConfig
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
  /** HuggingFace repo ID — used internally for mlx_lm */
  name: string
  /** Short, user-friendly display name */
  label: string
  size: string
  sizeBytes: number
  description: string
  recommended?: boolean
  /** Preferred OpenAI-compatible model id when running through LM Studio. */
  lmStudioName: string
  /** Terms used to match LM Studio's locally exposed model ids. */
  lmStudioAliases: string[][]
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    name: 'mlx-community/gemma-4-e2b-it-4bit',
    lmStudioName: 'google/gemma-4-e2b-it',
    lmStudioAliases: [
      ['gemma', '4', 'e2b'],
      ['gemma', 'e2b'],
      ['gemma', '2b']
    ],
    label: 'Gemma 4 E2B',
    size: '1.5 GB',
    sizeBytes: 1_500_000_000,
    description: 'Edge-sized. Fast & lightweight. Text + image + audio. Runs on 8GB+ Macs.'
  },
  {
    name: 'mlx-community/gemma-4-e4b-it-4bit',
    lmStudioName: 'google/gemma-4-e4b-it',
    lmStudioAliases: [
      ['gemma', '4', 'e4b'],
      ['gemma', 'e4b'],
      ['gemma', '4b']
    ],
    label: 'Gemma 4 E4B',
    size: '3 GB',
    sizeBytes: 3_000_000_000,
    description: 'Best all-rounder. Text + image + audio. Runs on 8GB+ Macs.',
    recommended: true
  },
  {
    name: 'mlx-community/gemma-4-26b-a4b-it-4bit',
    lmStudioName: 'google/gemma-4-26b-a4b-it',
    lmStudioAliases: [
      ['gemma', '4', '26b', 'a4b'],
      ['gemma', '26b', 'a4b'],
      ['gemma', '27b']
    ],
    label: 'Gemma 4 27B MoE',
    size: '16 GB',
    sizeBytes: 16_000_000_000,
    description: 'Mixture-of-Experts (26B, 4B active). 16GB+ RAM recommended.'
  },
  {
    name: 'mlx-community/gemma-4-31b-it-4bit',
    lmStudioName: 'google/gemma-4-31b-it',
    lmStudioAliases: [
      ['gemma', '4', '31b'],
      ['gemma', '31b']
    ],
    label: 'Gemma 4 31B',
    size: '18 GB',
    sizeBytes: 18_000_000_000,
    description: 'Frontier dense model. Best quality. 32GB+ RAM recommended.'
  }
]

export const DEFAULT_MODEL = 'mlx-community/gemma-4-e4b-it-4bit'

export function displayModelForRuntime(runtime: RuntimeConfig): ModelInfo | undefined {
  const appModel = runtime.appModel ?? runtime.model
  return AVAILABLE_MODELS.find((m) => m.name === appModel || m.lmStudioName === appModel)
}

export function resolveLMStudioModel(
  appModelName: string,
  loadedModelIds: string[]
): string | undefined {
  const appModel = AVAILABLE_MODELS.find((m) => m.name === appModelName)
  if (!appModel) return undefined

  const exact = loadedModelIds.find((id) => id === appModel.lmStudioName)
  if (exact) return exact

  const scored = loadedModelIds
    .map((id) => ({ id, score: scoreLMStudioMatch(appModel, id) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

  return scored[0]?.id
}

function scoreLMStudioMatch(appModel: ModelInfo, modelId: string): number {
  const normalized = normalizeModelId(modelId)
  let score = 0

  for (const alias of appModel.lmStudioAliases) {
    if (alias.every((term) => normalized.includes(normalizeModelId(term)))) {
      score = Math.max(score, 50 + alias.length * 10)
    }
  }

  if (!score) return 0
  if (normalized.includes('it') || normalized.includes('instruct')) score += 8
  if (normalized.includes('q4_k_m') || normalized.includes('q4km')) score += 6
  else if (normalized.includes('q5_k_m') || normalized.includes('q5km')) score += 4
  else if (normalized.includes('q8_0') || normalized.includes('q8')) score += 2
  if (normalized.includes('google')) score += 2
  if (normalized.includes('gemma')) score += 2

  return score
}

function normalizeModelId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

