import type {
  ChatProviderSelection,
  PiAiProviderConfig,
  RuntimeProviderId
} from '@shared/types'
import type { MLXChatMessage } from '../mlx'

export interface ProviderStreamChunk {
  content?: string
  done?: boolean
}

export interface ProviderStreamOptions {
  conversationId: string
  messages: MLXChatMessage[]
  signal?: AbortSignal
}

export interface LocalMlxStreamOptions extends ProviderStreamOptions {
  model: string
}

export interface PiAiStreamOptions extends ProviderStreamOptions {
  config: PiAiProviderConfig
  apiKey?: string
}

export interface RuntimeProviderDescriptor {
  id: RuntimeProviderId
  label: string
  description: string
}

export function defaultProviderSelection(model: string): ChatProviderSelection {
  return { id: 'local-mlx', model }
}
