import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { DESIGN_CATALOG, getDesignBySlug } from '@shared/designs'
import type { ConversationDesign, DesignCatalogItem, DesignClearResult } from '@shared/types'
import { wsDeleteFile, wsReadFile, wsWriteFile } from './workspace'

const GETDESIGN_MARKDOWN_BASE = 'https://getdesign.md/design-md'
const GITHUB_RAW_BASE =
  'https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md'
const CACHE_VERSION = 'awesome-design-md-main'
const DESIGN_FILE = 'DESIGN.md'
const FETCH_TIMEOUT_MS = 15_000

export function listDesignCatalog(): readonly DesignCatalogItem[] {
  return DESIGN_CATALOG
}

export async function installDesign(
  conversationId: string,
  slug: string
): Promise<ConversationDesign> {
  const item = requireDesign(slug)
  const markdown = await loadDesignMarkdown(item)
  await wsWriteFile(conversationId, DESIGN_FILE, formatWorkspaceDesignMarkdown(item, markdown))
  return {
    slug: item.slug,
    name: item.name,
    description: item.description,
    installedAt: Date.now()
  }
}

export async function clearInstalledDesign(
  conversationId: string,
  slug?: string
): Promise<DesignClearResult> {
  const item = slug ? getDesignBySlug(slug) : undefined
  if (slug && !item) {
    return { removed: false, reason: 'Unknown design.' }
  }

  let current: string
  try {
    current = await wsReadFile(conversationId, DESIGN_FILE)
  } catch {
    return { removed: false, reason: 'No DESIGN.md file is installed.' }
  }

  if (!item) {
    return { removed: false, reason: 'No design slug was provided.' }
  }

  const cached = await readCachedDesign(item.slug)
  if (!cached) {
    return { removed: false, reason: 'Cached design is missing, so DESIGN.md was left untouched.' }
  }

  const expected = formatWorkspaceDesignMarkdown(item, cached)
  if (normalize(current) !== normalize(expected)) {
    return {
      removed: false,
      reason: 'DESIGN.md has local edits, so it was left untouched.'
    }
  }

  await wsDeleteFile(conversationId, DESIGN_FILE)
  return { removed: true }
}

export async function readDesignContext(
  conversationId: string,
  design: ConversationDesign,
  maxChars = 28_000
): Promise<string | null> {
  const item = getDesignBySlug(design.slug)
  if (!item) return null

  let markdown: string
  try {
    markdown = await wsReadFile(conversationId, DESIGN_FILE)
  } catch {
    try {
      await installDesign(conversationId, design.slug)
      markdown = await wsReadFile(conversationId, DESIGN_FILE)
    } catch {
      return null
    }
  }

  if (markdown.length <= maxChars) return markdown
  return markdown.slice(0, maxChars) + '\n\n[DESIGN.md truncated for prompt length]'
}

function requireDesign(slug: string): DesignCatalogItem {
  const item = getDesignBySlug(slug)
  if (!item) throw new Error(`Unknown design: ${slug}`)
  return item
}

async function loadDesignMarkdown(item: DesignCatalogItem): Promise<string> {
  try {
    const remote = await fetchDesignMarkdown(item)
    await writeCachedDesign(item.slug, remote)
    return remote
  } catch (remoteError) {
    const cached = await readCachedDesign(item.slug)
    if (cached) return cached
    throw new Error(
      `Could not download DESIGN.md for ${item.name}, and no cached copy exists. ${
        (remoteError as Error).message
      }`
    )
  }
}

async function fetchDesignMarkdown(item: DesignCatalogItem): Promise<string> {
  const errors: string[] = []
  for (const url of designMarkdownUrls(item)) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'text/markdown,text/plain,*/*',
          'user-agent': 'Vibe Chat'
        }
      })
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`)
      }
      const text = await res.text()
      if (!looksLikeDesignMarkdown(text)) {
        throw new Error('Downloaded file did not look like a DESIGN.md document')
      }
      return text.trim() + '\n'
    } catch (e) {
      errors.push(`${url}: ${(e as Error).message}`)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(errors.join('; '))
}

function designMarkdownUrls(item: DesignCatalogItem): string[] {
  return [
    `${GETDESIGN_MARKDOWN_BASE}/${item.slug}/DESIGN.md`,
    `${GITHUB_RAW_BASE}/${item.slug}/DESIGN.md`
  ]
}

function looksLikeDesignMarkdown(text: string): boolean {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  const hasMarkdownStart = trimmed.startsWith('#') || trimmed.startsWith('---')
  const hasDesignContent =
    lower.includes('typography') ||
    lower.includes('palette') ||
    lower.includes('component') ||
    lower.includes('visual') ||
    lower.includes('description:')
  return hasMarkdownStart && hasDesignContent && trimmed.length > 500
}

function designCachePath(slug: string): string {
  return join(app.getPath('userData'), 'designs', CACHE_VERSION, `${safeSlug(slug)}.md`)
}

function safeSlug(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function readCachedDesign(slug: string): Promise<string | null> {
  try {
    return await readFile(designCachePath(slug), 'utf-8')
  } catch {
    return null
  }
}

async function writeCachedDesign(slug: string, content: string): Promise<void> {
  const target = designCachePath(slug)
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.tmp-${Date.now()}`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, target)
}

function formatWorkspaceDesignMarkdown(item: DesignCatalogItem, markdown: string): string {
  return [
    '<!-- Installed by Vibe Chat from getdesign.md.',
    `Design: ${item.name} (${item.slug}).`,
    'This is an inspired reference, not an official design system. -->',
    '',
    markdown.trim(),
    ''
  ].join('\n')
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}
