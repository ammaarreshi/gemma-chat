import { app, safeStorage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { OAuthCredentials } from '@mariozechner/pi-ai/oauth'

export type StoredCredential =
  | {
      type: 'api-key'
      apiKey: string
      updatedAt: number
    }
  | {
      type: 'oauth'
      credentials: OAuthCredentials
      updatedAt: number
    }

interface CredentialFile {
  version: 1
  credentials: Record<string, StoredCredential>
}

interface EncryptedCredentialFile {
  version: 1
  encoding: 'electron-safe-storage'
  data: string
}

const emptyFile = (): CredentialFile => ({ version: 1, credentials: {} })

function credentialsPath(): string {
  return join(app.getPath('userData'), 'credentials.enc.json')
}

function assertSecureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is not available on this system.')
  }
}

async function readCredentials(): Promise<CredentialFile> {
  let raw: string
  try {
    raw = await readFile(credentialsPath(), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile()
    throw e
  }

  assertSecureStorageAvailable()

  const envelope = JSON.parse(raw) as EncryptedCredentialFile
  if (envelope.encoding !== 'electron-safe-storage' || !envelope.data) {
    throw new Error('Unsupported credential storage format.')
  }
  const decrypted = safeStorage.decryptString(Buffer.from(envelope.data, 'base64'))
  return JSON.parse(decrypted) as CredentialFile
}

async function writeCredentials(file: CredentialFile): Promise<void> {
  assertSecureStorageAvailable()
  const encrypted = safeStorage.encryptString(JSON.stringify(file))
  const envelope: EncryptedCredentialFile = {
    version: 1,
    encoding: 'electron-safe-storage',
    data: encrypted.toString('base64')
  }
  await mkdir(dirname(credentialsPath()), { recursive: true })
  await writeFile(credentialsPath(), JSON.stringify(envelope, null, 2), { mode: 0o600 })
}

export async function getStoredCredential(key: string): Promise<StoredCredential | undefined> {
  const file = await readCredentials()
  return file.credentials[key]
}

export async function setStoredApiKey(key: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('API key is required.')
  const file = await readCredentials()
  file.credentials[key] = {
    type: 'api-key',
    apiKey: trimmed,
    updatedAt: Date.now()
  }
  await writeCredentials(file)
}

export async function setStoredOAuthCredentials(
  key: string,
  credentials: OAuthCredentials
): Promise<void> {
  const file = await readCredentials()
  file.credentials[key] = {
    type: 'oauth',
    credentials,
    updatedAt: Date.now()
  }
  await writeCredentials(file)
}

export async function clearStoredCredential(key: string): Promise<void> {
  const file = await readCredentials().catch(() => emptyFile())
  delete file.credentials[key]
  if (Object.keys(file.credentials).length === 0) {
    await rm(credentialsPath(), { force: true })
    return
  }
  await writeCredentials(file)
}
