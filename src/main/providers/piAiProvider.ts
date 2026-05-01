import {
  getModel,
  getModels,
  getProviders,
  stream,
  type Api,
  type AssistantMessage,
  type Context,
  type KnownProvider,
  type Message,
  type Model,
  type OpenAICompletionsCompat,
  type Usage
} from '@mariozechner/pi-ai'
import type { PiAiModelSummary, PiAiProviderConfig, PiAiProviderInfo } from '@shared/types'
import type { MLXChatMessage } from '../mlx'
import type { PiAiStreamOptions, ProviderStreamChunk } from './types'

const SUPPORTED_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'google-vertex',
  'mistral',
  'groq',
  'cerebras',
  'xai',
  'openrouter',
  'vercel-ai-gateway',
  'github-copilot',
  'openai-codex',
  'amazon-bedrock',
  'custom-openai-compatible'
] as const

const OAUTH_PROVIDER_IDS = new Set(['anthropic', 'github-copilot', 'openai-codex'])

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google / Gemini',
  'google-vertex': 'Google Vertex AI',
  mistral: 'Mistral',
  groq: 'Groq',
  cerebras: 'Cerebras',
  xai: 'xAI',
  openrouter: 'OpenRouter',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  'github-copilot': 'GitHub Copilot',
  'openai-codex': 'OpenAI Codex / ChatGPT',
  'amazon-bedrock': 'Amazon Bedrock',
  'custom-openai-compatible': 'Custom OpenAI-compatible'
}

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
})

export function listPiAiProviders(): PiAiProviderInfo[] {
  const catalog = new Set<string>(getProviders())
  return SUPPORTED_PROVIDER_IDS.filter(
    (providerId) => providerId === 'custom-openai-compatible' || catalog.has(providerId)
  ).map((providerId) => ({
    id: providerId,
    label: PROVIDER_LABELS[providerId] ?? providerId,
    supportsOAuth: OAUTH_PROVIDER_IDS.has(providerId),
    defaultAuthMode:
      providerId === 'custom-openai-compatible'
        ? 'none'
        : providerId === 'amazon-bedrock' || providerId === 'google-vertex'
        ? 'env'
        : OAUTH_PROVIDER_IDS.has(providerId)
          ? 'oauth'
          : 'api-key'
  }))
}

export function listPiAiModels(providerId: string): PiAiModelSummary[] {
  if (providerId === 'custom-openai-compatible') return []
  const models = getModels(providerId as KnownProvider) as Model<Api>[]
  return models.map(modelToSummary)
}

export function modelToSummary(model: Model<Api>): PiAiModelSummary {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    input: model.input,
    reasoning: model.reasoning
  }
}

export async function* streamPiAi(
  options: PiAiStreamOptions
): AsyncGenerator<ProviderStreamChunk> {
  const model = resolvePiAiModel(options.config)
  const context = buildPiAiContext(model, options.messages)
  const eventStream = stream(model, context, {
    apiKey: options.apiKey,
    signal: options.signal,
    sessionId: options.conversationId
  })

  for await (const event of eventStream) {
    if (event.type === 'text_delta' && event.delta) {
      yield { content: event.delta }
    } else if (event.type === 'done') {
      yield { done: true }
      return
    } else if (event.type === 'error') {
      if (event.reason === 'aborted') {
        yield { done: true }
        return
      }
      throw new Error(event.error.errorMessage || 'Pi AI stream failed')
    }
  }

  yield { done: true }
}

export function resolvePiAiModel(config: PiAiProviderConfig): Model<Api> {
  if (config.providerId === 'custom-openai-compatible') {
    return createCustomOpenAICompatibleModel(config)
  }

  const providerId = config.providerId as KnownProvider
  const direct = getModel(providerId, config.modelId as never) as Model<Api> | undefined
  if (direct) return applyConfigOverrides(direct, config)

  const fallback = (getModels(providerId) as Model<Api>[])[0]
  if (!fallback) {
    throw new Error(`Model not found: ${config.providerId}/${config.modelId}`)
  }

  return applyConfigOverrides(
    {
      ...fallback,
      id: config.modelId,
      name: config.modelId
    },
    config
  )
}

function createCustomOpenAICompatibleModel(
  config: PiAiProviderConfig
): Model<'openai-completions'> {
  if (!config.baseUrl?.trim()) {
    throw new Error('Custom OpenAI-compatible providers require a base URL.')
  }

  return {
    id: config.modelId,
    name: config.modelId,
    api: 'openai-completions',
    provider: 'custom-openai-compatible',
    baseUrl: config.baseUrl.trim(),
    contextWindow: config.contextWindow ?? 128000,
    maxTokens: config.maxTokens ?? 8192,
    input: config.input ?? ['text'],
    reasoning: config.reasoning ?? false,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    compat: normalizeCompat(config)
  }
}

function applyConfigOverrides(model: Model<Api>, config: PiAiProviderConfig): Model<Api> {
  const baseUrl = config.baseUrl?.trim()
  const compat = normalizeCompat(config)
  return {
    ...model,
    id: config.modelId || model.id,
    name: config.modelId && config.modelId !== model.id ? config.modelId : model.name,
    baseUrl: baseUrl || model.baseUrl,
    contextWindow: config.contextWindow ?? model.contextWindow,
    maxTokens: config.maxTokens ?? model.maxTokens,
    input: config.input ?? model.input,
    reasoning: config.reasoning ?? model.reasoning,
    ...(compat ? { compat: compat as never } : {})
  }
}

function normalizeCompat(config: PiAiProviderConfig): OpenAICompletionsCompat | undefined {
  if (!config.compat) return undefined
  return {
    supportsStore: config.compat.supportsStore,
    supportsDeveloperRole: config.compat.supportsDeveloperRole,
    supportsReasoningEffort: config.compat.supportsReasoningEffort,
    supportsUsageInStreaming: config.compat.supportsUsageInStreaming,
    maxTokensField: config.compat.maxTokensField
  }
}

function buildPiAiContext(model: Model<Api>, messages: MLXChatMessage[]): Context {
  const systemParts: string[] = []
  const converted: Message[] = []
  const now = Date.now()

  for (const message of messages) {
    if (!message.content.trim()) continue

    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }

    if (message.role === 'assistant') {
      converted.push(toAssistantMessage(model, message.content, now))
      continue
    }

    if (message.role === 'tool') {
      converted.push({
        role: 'user',
        content: `Tool result:\n${message.content}`,
        timestamp: now
      })
      continue
    }

    converted.push({
      role: 'user',
      content: message.content,
      timestamp: now
    })
  }

  return {
    systemPrompt: systemParts.join('\n\n') || undefined,
    messages: converted
  }
}

function toAssistantMessage(model: Model<Api>, text: string, timestamp: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: 'stop',
    timestamp
  }
}
