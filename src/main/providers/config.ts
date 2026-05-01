import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  DEFAULT_MODEL,
  DEFAULT_PI_AI_CONFIG,
  type AppProviderConfig,
  type PiAiProviderConfig
} from '@shared/types'

const CONFIG_FILE = 'provider-config.json'

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

export function defaultProviderConfig(): AppProviderConfig {
  return {
    selectedProvider: 'local-mlx',
    localModel: DEFAULT_MODEL,
    piAi: { ...DEFAULT_PI_AI_CONFIG }
  }
}

export async function readProviderConfig(): Promise<AppProviderConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    return normalizeProviderConfig(JSON.parse(raw) as Partial<AppProviderConfig>)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaultProviderConfig()
    throw e
  }
}

export async function writeProviderConfig(config: AppProviderConfig): Promise<AppProviderConfig> {
  const normalized = normalizeProviderConfig(config)
  await mkdir(dirname(configPath()), { recursive: true })
  await writeFile(configPath(), JSON.stringify(normalized, null, 2))
  return normalized
}

export function normalizeProviderConfig(config: Partial<AppProviderConfig>): AppProviderConfig {
  const defaults = defaultProviderConfig()
  return {
    selectedProvider:
      config.selectedProvider === 'pi-ai' || config.selectedProvider === 'local-mlx'
        ? config.selectedProvider
        : defaults.selectedProvider,
    localModel: config.localModel || defaults.localModel,
    piAi: normalizePiAiConfig(config.piAi)
  }
}

export function normalizePiAiConfig(config?: Partial<PiAiProviderConfig>): PiAiProviderConfig {
  const defaults = defaultProviderConfig().piAi
  return {
    providerId: config?.providerId || defaults.providerId,
    modelId: config?.modelId || defaults.modelId,
    authMode: config?.authMode || defaults.authMode,
    baseUrl: config?.baseUrl,
    contextWindow: config?.contextWindow,
    maxTokens: config?.maxTokens,
    input: config?.input ?? defaults.input,
    reasoning: config?.reasoning ?? defaults.reasoning,
    compat: config?.compat
  }
}
