import { findEnvKeys, getEnvApiKey } from '@mariozechner/pi-ai'
import {
  getOAuthApiKey,
  getOAuthProvider,
  refreshOAuthToken,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
  type OAuthPrompt
} from '@mariozechner/pi-ai/oauth'
import type { PiAiAuthStatus, PiAiProviderConfig } from '@shared/types'
import {
  clearStoredCredential,
  getStoredCredential,
  setStoredApiKey,
  setStoredOAuthCredentials
} from './credentialStore'

const OAUTH_PROVIDER_IDS = new Set(['anthropic', 'github-copilot', 'openai-codex'])
const AUTHENTICATED_MARKER = '<authenticated>'

export function credentialKey(config: PiAiProviderConfig): string {
  if (config.providerId === 'custom-openai-compatible') {
    return `${config.providerId}:${config.baseUrl?.trim() ?? 'default'}`
  }
  return config.providerId
}

export function supportsOAuth(providerId: string): boolean {
  return OAUTH_PROVIDER_IDS.has(providerId) && !!getOAuthProvider(providerId)
}

export async function getPiAiAuthStatus(config: PiAiProviderConfig): Promise<PiAiAuthStatus> {
  const key = credentialKey(config)
  const stored = await getStoredCredential(key).catch(() => undefined)
  const envKeys = findEnvKeys(config.providerId) ?? []
  const oauthSupported = supportsOAuth(config.providerId)

  if (config.authMode === 'none') {
    return {
      providerId: config.providerId,
      authMode: config.authMode,
      ready: true,
      hasStoredCredential: false,
      supportsOAuth: oauthSupported,
      message: 'No authentication will be sent.'
    }
  }

  if (config.authMode === 'env') {
    const apiKey = getEnvApiKey(config.providerId)
    return {
      providerId: config.providerId,
      authMode: config.authMode,
      ready: !!apiKey,
      hasStoredCredential: false,
      envKeys,
      supportsOAuth: oauthSupported,
      message: apiKey ? `Using ${envKeys[0] ?? 'environment credentials'}.` : 'No environment credential found.'
    }
  }

  if (config.authMode === 'oauth') {
    const ready = stored?.type === 'oauth'
    return {
      providerId: config.providerId,
      authMode: config.authMode,
      ready,
      hasStoredCredential: ready,
      maskedCredential: ready ? 'OAuth credential stored' : undefined,
      envKeys,
      supportsOAuth: oauthSupported,
      message: oauthSupported
        ? ready
          ? 'Signed in.'
          : 'Sign in required.'
        : 'OAuth is not supported for this provider.'
    }
  }

  const ready = stored?.type === 'api-key'
  return {
    providerId: config.providerId,
    authMode: config.authMode,
    ready,
    hasStoredCredential: ready,
    maskedCredential: stored?.type === 'api-key' ? maskSecret(stored.apiKey) : undefined,
    envKeys,
    supportsOAuth: oauthSupported,
    message: ready ? 'API key stored.' : 'API key required.'
  }
}

export async function setPiAiApiKey(
  config: PiAiProviderConfig,
  apiKey: string
): Promise<PiAiAuthStatus> {
  await setStoredApiKey(credentialKey(config), apiKey)
  return getPiAiAuthStatus(config)
}

export async function clearPiAiCredentials(config: PiAiProviderConfig): Promise<PiAiAuthStatus> {
  await clearStoredCredential(credentialKey(config))
  return getPiAiAuthStatus(config)
}

export async function refreshPiAiOAuth(config: PiAiProviderConfig): Promise<PiAiAuthStatus> {
  const key = credentialKey(config)
  const stored = await getStoredCredential(key)
  if (stored?.type !== 'oauth') {
    throw new Error('No OAuth credentials are stored for this provider.')
  }
  const refreshed = await refreshOAuthToken(config.providerId, stored.credentials)
  await setStoredOAuthCredentials(key, refreshed)
  return getPiAiAuthStatus(config)
}

export async function loginPiAiOAuth(
  config: PiAiProviderConfig,
  callbacks: OAuthLoginCallbacks
): Promise<PiAiAuthStatus> {
  const provider = getOAuthProvider(config.providerId)
  if (!provider) {
    throw new Error(`OAuth is not supported for ${config.providerId}.`)
  }
  const credentials = await provider.login(callbacks)
  await setStoredOAuthCredentials(credentialKey(config), credentials)
  return getPiAiAuthStatus(config)
}

export async function resolvePiAiApiKey(
  config: PiAiProviderConfig
): Promise<string | undefined> {
  if (config.authMode === 'none') {
    return config.providerId === 'custom-openai-compatible' ? 'dummy' : undefined
  }

  if (config.authMode === 'env') {
    const apiKey = getEnvApiKey(config.providerId)
    if (!apiKey) {
      throw new Error(`No environment credential found for ${config.providerId}.`)
    }
    return apiKey === AUTHENTICATED_MARKER ? undefined : apiKey
  }

  const stored = await getStoredCredential(credentialKey(config))

  if (config.authMode === 'api-key') {
    if (stored?.type !== 'api-key') {
      throw new Error(`API key is required for ${config.providerId}.`)
    }
    return stored.apiKey
  }

  if (stored?.type !== 'oauth') {
    throw new Error(`Sign in is required for ${config.providerId}.`)
  }

  const credentials: Record<string, OAuthCredentials> = {
    [config.providerId]: stored.credentials
  }
  const result = await getOAuthApiKey(config.providerId, credentials)
  if (!result) {
    throw new Error(`Sign in is required for ${config.providerId}.`)
  }
  await setStoredOAuthCredentials(credentialKey(config), result.newCredentials)
  return result.apiKey
}

export function coerceOAuthPrompt(prompt: OAuthPrompt): OAuthPrompt {
  return {
    message: prompt.message,
    placeholder: prompt.placeholder,
    allowEmpty: prompt.allowEmpty
  }
}

function maskSecret(secret: string): string {
  const trimmed = secret.trim()
  if (trimmed.length <= 10) return '••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}
