import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  ChatRequest,
  AppProviderConfig,
  ConversationDesign,
  DesignCatalogItem,
  DesignClearResult,
  PiAiAuthEvent,
  PiAiAuthStatus,
  PiAiModelSummary,
  PiAiProviderConfig,
  ProviderListResponse,
  SetupStatus,
  StreamChunk,
  WorkspaceInfo,
  WorkspaceFile
} from '../shared/types'

const api = {
  startSetup: (model: string): Promise<void> => ipcRenderer.invoke('setup:start', model),

  switchModel: (model: string): Promise<void> => ipcRenderer.invoke('model:switch', model),

  checkMLX: (): Promise<{ hasMLX: boolean; hasOllama?: boolean }> =>
    ipcRenderer.invoke('setup:status'),

  onSetupStatus: (cb: (s: SetupStatus) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, s: SetupStatus): void => cb(s)
    ipcRenderer.on('setup:status', listener)
    return () => ipcRenderer.removeListener('setup:status', listener)
  },

  listLocalModels: (): Promise<string[]> => ipcRenderer.invoke('models:list-local'),

  listProviders: (): Promise<ProviderListResponse> => ipcRenderer.invoke('providers:list'),

  listPiAiModels: (providerId: string): Promise<PiAiModelSummary[]> =>
    ipcRenderer.invoke('providers:models:list', providerId),

  getProviderConfig: (): Promise<AppProviderConfig> =>
    ipcRenderer.invoke('providers:config:get'),

  saveProviderConfig: (config: AppProviderConfig): Promise<AppProviderConfig> =>
    ipcRenderer.invoke('providers:config:save', config),

  listDesigns: (): Promise<DesignCatalogItem[]> => ipcRenderer.invoke('designs:list'),

  installDesign: (conversationId: string, slug: string): Promise<ConversationDesign> =>
    ipcRenderer.invoke('designs:install', { conversationId, slug }),

  clearDesign: (conversationId: string, slug?: string): Promise<DesignClearResult> =>
    ipcRenderer.invoke('designs:clear', { conversationId, slug }),

  getProviderAuthStatus: (config: PiAiProviderConfig): Promise<PiAiAuthStatus> =>
    ipcRenderer.invoke('providers:auth:getStatus', config),

  setProviderApiKey: (
    config: PiAiProviderConfig,
    apiKey: string
  ): Promise<PiAiAuthStatus> =>
    ipcRenderer.invoke('providers:auth:setApiKey', { config, apiKey }),

  clearProviderAuth: (config: PiAiProviderConfig): Promise<PiAiAuthStatus> =>
    ipcRenderer.invoke('providers:auth:clear', config),

  loginProviderOAuth: (config: PiAiProviderConfig): Promise<PiAiAuthStatus> =>
    ipcRenderer.invoke('providers:auth:loginOAuth', config),

  refreshProviderAuth: (config: PiAiProviderConfig): Promise<PiAiAuthStatus> =>
    ipcRenderer.invoke('providers:auth:refresh', config),

  testProviderAuth: (config: PiAiProviderConfig): Promise<{ ok: true }> =>
    ipcRenderer.invoke('providers:auth:test', config),

  openProviderAuthUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('providers:auth:openExternal', url),

  respondProviderAuthPrompt: (promptId: string, value: string): Promise<void> =>
    ipcRenderer.invoke('providers:auth:promptResponse', { promptId, value }),

  onProviderAuthEvent: (cb: (ev: PiAiAuthEvent) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, ev: PiAiAuthEvent): void => cb(ev)
    ipcRenderer.on('providers:auth:event', listener)
    return () => ipcRenderer.removeListener('providers:auth:event', listener)
  },

  sendChat: async (req: ChatRequest, onChunk: (c: StreamChunk) => void): Promise<void> => {
    const { channel } = (await ipcRenderer.invoke('chat:send', req)) as { channel: string }
    return new Promise((resolve) => {
      const listener = (_: IpcRendererEvent, chunk: StreamChunk): void => {
        onChunk(chunk)
        if (chunk.type === 'done' || chunk.type === 'error') {
          ipcRenderer.removeListener(channel, listener)
          resolve()
        }
      }
      ipcRenderer.on(channel, listener)
    })
  },

  abortChat: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke('chat:abort', conversationId),

  listTools: (): Promise<Array<{ name: string; description: string; mode: string }>> =>
    ipcRenderer.invoke('tools:list'),

  getWorkspace: (conversationId: string): Promise<WorkspaceInfo> =>
    ipcRenderer.invoke('workspace:info', conversationId),

  listWorkspace: (conversationId: string): Promise<WorkspaceFile[]> =>
    ipcRenderer.invoke('workspace:list', conversationId),

  openWorkspace: (conversationId: string): Promise<void> =>
    ipcRenderer.invoke('workspace:open-external', conversationId),

  workspaceServerPort: (): Promise<number> => ipcRenderer.invoke('workspace:server-port'),

  onWorkspaceChanged: (cb: (ev: { conversationId: string }) => void): (() => void) => {
    const listener = (_: IpcRendererEvent, ev: { conversationId: string }): void => cb(ev)
    ipcRenderer.on('workspace:changed', listener)
    return () => ipcRenderer.removeListener('workspace:changed', listener)
  },

  onRawChunk: (
    cb: (ev: { conversationId: string; chunk: string }) => void
  ): (() => void) => {
    const listener = (
      _: IpcRendererEvent,
      ev: { conversationId: string; chunk: string }
    ): void => cb(ev)
    ipcRenderer.on('chat:raw', listener)
    return () => ipcRenderer.removeListener('chat:raw', listener)
  },

  onFileStreaming: (
    cb: (ev: { conversationId: string; path: string; content: string; done: boolean }) => void
  ): (() => void) => {
    const listener = (
      _: IpcRendererEvent,
      ev: { conversationId: string; path: string; content: string; done: boolean }
    ): void => cb(ev)
    ipcRenderer.on('file:streaming', listener)
    return () => ipcRenderer.removeListener('file:streaming', listener)
  },

  transcribeAudio: (base64: string, model: string): Promise<{ text: string }> =>
    ipcRenderer.invoke('audio:transcribe', { base64, model })
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
