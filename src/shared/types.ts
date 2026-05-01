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
  provider?: ChatProviderSelection
  enableTools: boolean
  mode: AgentMode
  design?: ConversationDesign
}

export interface DesignCatalogItem {
  slug: string
  name: string
  category: string
  description: string
  sourceUrl: string
}

export interface ConversationDesign {
  slug: string
  name: string
  description: string
  installedAt: number
  source?: 'catalog' | 'extracted'
  sourceUrl?: string
  customId?: string
}

export interface DesignClearResult {
  removed: boolean
  reason?: string
}

export interface DesignExtractionRequest {
  conversationId: string
  url: string
  name?: string
  full?: boolean
  dark?: boolean
  responsive?: boolean
}

export interface DesignExtractionStarted {
  jobId: string
}

export type DesignExtractionEvent =
  | {
      type: 'progress'
      jobId: string
      message: string
    }
  | {
      type: 'done'
      jobId: string
      design: ConversationDesign
    }
  | {
      type: 'error'
      jobId: string
      error: string
    }

export type RuntimeProviderId = 'local-mlx' | 'ollama' | 'pi-ai'

export type PiAiAuthMode = 'api-key' | 'oauth' | 'env' | 'none'

export type PiAiProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'google-vertex'
  | 'mistral'
  | 'groq'
  | 'cerebras'
  | 'xai'
  | 'openrouter'
  | 'vercel-ai-gateway'
  | 'github-copilot'
  | 'openai-codex'
  | 'amazon-bedrock'
  | 'custom-openai-compatible'
  | string

export interface PiAiCompatSettings {
  supportsStore?: boolean
  supportsDeveloperRole?: boolean
  supportsReasoningEffort?: boolean
  supportsUsageInStreaming?: boolean
  maxTokensField?: 'max_completion_tokens' | 'max_tokens'
}

export interface PiAiProviderConfig {
  providerId: PiAiProviderId
  modelId: string
  authMode: PiAiAuthMode
  baseUrl?: string
  contextWindow?: number
  maxTokens?: number
  input?: Array<'text' | 'image'>
  reasoning?: boolean
  compat?: PiAiCompatSettings
}

export interface LocalMlxProviderSelection {
  id: 'local-mlx'
  model: string
}

export interface LocalOllamaProviderSelection {
  id: 'ollama'
  model: string
}

export interface PiAiProviderSelection {
  id: 'pi-ai'
  config: PiAiProviderConfig
}

export type ChatProviderSelection =
  | LocalMlxProviderSelection
  | LocalOllamaProviderSelection
  | PiAiProviderSelection

export interface AppProviderConfig {
  selectedProvider: RuntimeProviderId
  localModel: string
  ollamaModel: string
  piAi: PiAiProviderConfig
}

export interface ProviderInfo {
  id: RuntimeProviderId
  label: string
  description: string
}

export interface PiAiProviderInfo {
  id: string
  label: string
  supportsOAuth: boolean
  defaultAuthMode: PiAiAuthMode
}

export interface ProviderListResponse {
  providers: ProviderInfo[]
  piAiProviders: PiAiProviderInfo[]
}

export interface PiAiModelSummary {
  id: string
  name: string
  provider: string
  api: string
  contextWindow: number
  maxTokens: number
  input: Array<'text' | 'image'>
  reasoning: boolean
}

export interface PiAiAuthStatus {
  providerId: string
  authMode: PiAiAuthMode
  ready: boolean
  hasStoredCredential: boolean
  maskedCredential?: string
  envKeys?: string[]
  supportsOAuth: boolean
  message?: string
}

export type PiAiAuthEvent =
  | {
      type: 'auth'
      requestId: string
      url: string
      instructions?: string
    }
  | {
      type: 'prompt'
      requestId: string
      promptId: string
      message: string
      placeholder?: string
      allowEmpty?: boolean
    }
  | {
      type: 'progress'
      requestId: string
      message: string
    }
  | {
      type: 'complete'
      requestId: string
      status: PiAiAuthStatus
    }
  | {
      type: 'error'
      requestId: string
      error: string
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
  provider: 'mlx' | 'ollama'
  /** HuggingFace repo ID or prefixed Ollama model id. */
  name: string
  /** Short, user-friendly display name */
  label: string
  size: string
  sizeBytes: number
  description: string
  recommended?: boolean
}

export const OLLAMA_MODEL_PREFIX = 'ollama:'

export function runtimeModelName(model: string): string {
  return model.startsWith(OLLAMA_MODEL_PREFIX) ? model.slice(OLLAMA_MODEL_PREFIX.length) : model
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    provider: 'ollama',
    name: 'ollama:gemma4:31b',
    label: 'Gemma 4 31B',
    size: 'Ollama',
    sizeBytes: 0,
    description: 'Use the locally installed gemma4:31b model through Ollama.'
  },
  {
    provider: 'ollama',
    name: 'ollama:gemma:7b',
    label: 'Gemma 7B',
    size: 'Ollama',
    sizeBytes: 0,
    description: 'Use the locally installed gemma:7b model through Ollama.'
  },
  {
    provider: 'ollama',
    name: 'ollama:qwen2.5:7b',
    label: 'Qwen 2.5 7B',
    size: 'Ollama',
    sizeBytes: 0,
    description: 'Use the locally installed qwen2.5:7b model through Ollama.'
  },
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
  }
]

export const DEFAULT_OLLAMA_MODEL = 'ollama:gemma4:31b'
export const DEFAULT_MODEL = 'mlx-community/gemma-4-e4b-it-4bit'

export const DEFAULT_PI_AI_CONFIG: PiAiProviderConfig = {
  providerId: 'openai',
  modelId: 'gpt-4o-mini',
  authMode: 'api-key',
  input: ['text'],
  reasoning: false
}
