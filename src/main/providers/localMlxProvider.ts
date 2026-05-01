import { chatStream } from '../mlx'
import type { LocalMlxStreamOptions, ProviderStreamChunk } from './types'

export async function* streamLocalMlx(
  options: LocalMlxStreamOptions
): AsyncGenerator<ProviderStreamChunk> {
  yield* chatStream({
    model: options.model,
    messages: options.messages,
    signal: options.signal
  })
}
