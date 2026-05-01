import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createRequire } from 'module'
import { mkdir, readdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { DESIGN_CATALOG, getDesignBySlug } from '@shared/designs'
import type {
  ConversationDesign,
  DesignCatalogItem,
  DesignClearResult,
  DesignExtractionEvent,
  DesignExtractionRequest
} from '@shared/types'
import { wsDeleteFile, wsReadFile, wsWriteFile } from './workspace'

const GETDESIGN_MARKDOWN_BASE = 'https://getdesign.md/design-md'
const GITHUB_RAW_BASE =
  'https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md'
const CACHE_VERSION = 'awesome-design-md-main'
const DESIGN_FILE = 'DESIGN.md'
const FETCH_TIMEOUT_MS = 15_000
const EXTRACT_TIMEOUT_MS = 4 * 60_000
const require = createRequire(import.meta.url)

interface ExtractionJob {
  process: ChildProcess
  outputDir: string
  cancelled?: boolean
  timedOut?: boolean
}

const extractionJobs = new Map<string, ExtractionJob>()

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
    installedAt: Date.now(),
    source: 'catalog',
    sourceUrl: item.sourceUrl
  }
}

export async function listCustomDesigns(): Promise<ConversationDesign[]> {
  let entries: string[]
  try {
    entries = await readdir(customDesignsRoot())
  } catch {
    return []
  }

  const designs: ConversationDesign[] = []
  for (const id of entries) {
    try {
      const metadata = JSON.parse(
        await readFile(customDesignMetadataPath(id), 'utf-8')
      ) as ConversationDesign
      if (metadata.source === 'extracted' && metadata.customId) {
        designs.push(metadata)
      }
    } catch {
      // Ignore incomplete or old extraction directories.
    }
  }
  return designs.sort((a, b) => b.installedAt - a.installedAt)
}

export async function installCustomDesign(
  conversationId: string,
  customId: string
): Promise<ConversationDesign> {
  const design = await readCustomDesignMetadata(customId)
  const markdown = await readFile(customDesignMarkdownPath(customId), 'utf-8')
  await wsWriteFile(conversationId, DESIGN_FILE, formatWorkspaceCustomDesignMarkdown(design, markdown))
  return { ...design, installedAt: Date.now() }
}

export async function clearInstalledDesign(
  conversationId: string,
  design?: ConversationDesign | string
): Promise<DesignClearResult> {
  const slug = typeof design === 'string' ? design : design?.slug
  const source = typeof design === 'string' ? 'catalog' : (design?.source ?? 'catalog')
  const item = source === 'catalog' && slug ? getDesignBySlug(slug) : undefined
  if (source === 'catalog' && slug && !item) {
    return { removed: false, reason: 'Unknown catalog design.' }
  }

  let current: string
  try {
    current = await wsReadFile(conversationId, DESIGN_FILE)
  } catch {
    return { removed: false, reason: 'No DESIGN.md file is installed.' }
  }

  let expected: string | null = null
  if (source === 'extracted') {
    const customId = typeof design === 'string' ? undefined : design?.customId
    if (!customId) return { removed: false, reason: 'No extracted design id was provided.' }
    try {
      const customDesign = await readCustomDesignMetadata(customId)
      const markdown = await readFile(customDesignMarkdownPath(customId), 'utf-8')
      expected = formatWorkspaceCustomDesignMarkdown(customDesign, markdown)
    } catch {
      return {
        removed: false,
        reason: 'Stored extracted design is missing, so DESIGN.md was left untouched.'
      }
    }
  } else {
    if (!item) return { removed: false, reason: 'No design slug was provided.' }
    const cached = await readCachedDesign(item.slug)
    if (!cached) {
      return { removed: false, reason: 'Cached design is missing, so DESIGN.md was left untouched.' }
    }
    expected = formatWorkspaceDesignMarkdown(item, cached)
  }

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
  let markdown: string
  try {
    markdown = await wsReadFile(conversationId, DESIGN_FILE)
  } catch {
    try {
      if ((design.source ?? 'catalog') === 'extracted' && design.customId) {
        await installCustomDesign(conversationId, design.customId)
      } else {
        await installDesign(conversationId, design.slug)
      }
      markdown = await wsReadFile(conversationId, DESIGN_FILE)
    } catch {
      return null
    }
  }

  if (markdown.length <= maxChars) return markdown
  return markdown.slice(0, maxChars) + '\n\n[DESIGN.md truncated for prompt length]'
}

export function startDesignExtraction(
  request: DesignExtractionRequest,
  emit: (event: DesignExtractionEvent) => void
): { jobId: string } {
  const url = normalizeExtractUrl(request.url)
  const now = Date.now()
  const jobId = `extract_${now}_${Math.random().toString(36).slice(2, 8)}`
  const name = (request.name?.trim() || siteNameFromUrl(url)).slice(0, 80)
  const prefix = safeSlug(name) || safeSlug(new URL(url).hostname) || 'site'
  const outputDir = join(customDesignDir(jobId), 'output')
  const cliPath = designlangCliPath()
  const args = [
    cliPath,
    url,
    '--out',
    outputDir,
    '--name',
    prefix,
    '--wait',
    '1000',
    '--no-prompts',
    '--no-history'
  ]

  if (request.full) {
    args.push('--full')
  } else {
    if (request.dark) args.push('--dark')
    if (request.responsive) args.push('--responsive')
  }

  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const job: ExtractionJob = { process: child, outputDir }
  extractionJobs.set(jobId, job)
  emit({ type: 'progress', jobId, message: 'Starting design extraction...' })

  let output = ''
  const pushOutput = (chunk: Buffer): void => {
    const text = stripAnsi(chunk.toString('utf-8'))
    output += text
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const last = lines.at(-1)
    if (last && !last.includes(outputDir)) {
      emit({ type: 'progress', jobId, message: last.slice(0, 160) })
    }
  }
  child.stdout.on('data', pushOutput)
  child.stderr.on('data', pushOutput)

  const phaseTimer = setInterval(() => {
    emit({
      type: 'progress',
      jobId,
      message: 'Crawling the site and extracting visual tokens...'
    })
  }, 12_000)

  const timeout = setTimeout(() => {
    job.timedOut = true
    child.kill('SIGTERM')
    emit({
      type: 'error',
      jobId,
      error: 'Design extraction timed out. Try a simpler page or disable full scan.'
    })
  }, request.full ? EXTRACT_TIMEOUT_MS * 2 : EXTRACT_TIMEOUT_MS)

  child.on('close', async (code) => {
    clearInterval(phaseTimer)
    clearTimeout(timeout)
    extractionJobs.delete(jobId)
    if (job.cancelled || job.timedOut) return
    if (code !== 0) {
      emit({
        type: 'error',
        jobId,
        error: summarizeExtractionFailure(output, code)
      })
      return
    }

    try {
      const markdownPath = await findGeneratedDesignMarkdown(outputDir, prefix)
      const markdown = await readFile(markdownPath, 'utf-8')
      if (!looksLikeDesignMarkdown(markdown)) {
        throw new Error('Generated DESIGN.md did not look like a design reference.')
      }
      await mkdir(customDesignDir(jobId), { recursive: true })
      await writeFile(customDesignMarkdownPath(jobId), markdown.trim() + '\n', 'utf-8')
      const design: ConversationDesign = {
        slug: jobId,
        name,
        description: `Extracted from ${new URL(url).hostname}`,
        installedAt: Date.now(),
        source: 'extracted',
        sourceUrl: url,
        customId: jobId
      }
      await writeFile(customDesignMetadataPath(jobId), JSON.stringify(design, null, 2), 'utf-8')
      await wsWriteFile(
        request.conversationId,
        DESIGN_FILE,
        formatWorkspaceCustomDesignMarkdown(design, markdown)
      )
      emit({ type: 'done', jobId, design })
    } catch (e) {
      emit({ type: 'error', jobId, error: (e as Error).message })
    }
  })

  child.on('error', (e) => {
    clearInterval(phaseTimer)
    clearTimeout(timeout)
    extractionJobs.delete(jobId)
    emit({ type: 'error', jobId, error: e.message })
  })

  return { jobId }
}

export function cancelDesignExtraction(jobId: string): boolean {
  const job = extractionJobs.get(jobId)
  if (!job) return false
  job.cancelled = true
  job.process.kill('SIGTERM')
  extractionJobs.delete(jobId)
  return true
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
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

function formatWorkspaceCustomDesignMarkdown(
  design: ConversationDesign,
  markdown: string
): string {
  return [
    '<!-- Installed by Vibe Chat from a live site extraction.',
    `Design: ${design.name} (${design.customId ?? design.slug}).`,
    design.sourceUrl ? `Source: ${design.sourceUrl}. -->` : '-->',
    '',
    markdown.trim(),
    ''
  ].join('\n')
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function customDesignsRoot(): string {
  return join(app.getPath('userData'), 'custom-designs')
}

function customDesignDir(id: string): string {
  return join(customDesignsRoot(), safeSlug(id))
}

function customDesignMetadataPath(id: string): string {
  return join(customDesignDir(id), 'metadata.json')
}

function customDesignMarkdownPath(id: string): string {
  return join(customDesignDir(id), DESIGN_FILE)
}

async function readCustomDesignMetadata(id: string): Promise<ConversationDesign> {
  const metadata = JSON.parse(await readFile(customDesignMetadataPath(id), 'utf-8')) as ConversationDesign
  if (metadata.source !== 'extracted' || !metadata.customId) {
    throw new Error('Invalid extracted design metadata.')
  }
  return metadata
}

function normalizeExtractUrl(input: string): string {
  const raw = input.trim()
  if (!raw) throw new Error('Enter a website URL.')
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.')
  }
  return url.toString()
}

function siteNameFromUrl(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '')
  return host.split('.').filter(Boolean).slice(0, 2).join(' ')
}

function designlangCliPath(): string {
  const packagePath = require.resolve('designlang/package.json')
  return join(dirname(packagePath), 'bin', 'design-extract.js')
}

async function findGeneratedDesignMarkdown(outputDir: string, prefix: string): Promise<string> {
  const preferred = join(outputDir, `${prefix}-DESIGN.md`)
  try {
    await readFile(preferred, 'utf-8')
    return preferred
  } catch {
    const files = await readdir(outputDir)
    const found = files.find((file) => file.endsWith('-DESIGN.md'))
    if (!found) throw new Error('designlang finished but did not write a DESIGN.md file.')
    return join(outputDir, found)
  }
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r/g, '\n')
}

function summarizeExtractionFailure(output: string, code: number | null): string {
  const cleaned = stripAnsi(output)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join('\n')
  return `designlang exited with code ${code ?? 'unknown'}${cleaned ? `:\n${cleaned}` : '.'}`
}
