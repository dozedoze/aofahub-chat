import { strFromU8, unzipSync } from 'fflate'
import { create } from 'zustand'
import { API_ORIGIN, ApiError, request } from './api/client.js'

/**
 * 用户自己的 MCP 服务器和 Skill。配置、密钥都存在网关，按账号绑定，这里只做读写。
 * 密钥值只会经 setSecret 发出去，网关不会回传，本地也不保存。
 */

export type McpTransport = 'auto' | 'http' | 'sse'

export type McpServer = {
  id: string
  name: string
  url: string
  transport: McpTransport
  headers: Record<string, string>
  enabled: boolean
  allowWrite: boolean
}

export type Skill = {
  id: string
  name: string
  description: string
  body: string
  enabled: boolean
}

export type ServerStatus = { ok: boolean; at: number; toolCount: number; error?: string }

export type ExtensionsConfig = {
  version: number
  mcpServers: McpServer[]
  skills: Skill[]
  /** 已保存的密钥名，不含值 */
  secrets: string[]
  status: Record<string, ServerStatus>
  /** 网关是否配置了密钥主密钥；没配置时不能保存令牌 */
  secretsEnabled: boolean
  /** 管理员是否允许用户使用 MCP */
  mcpEnabled: boolean
}

export type ToolInfo = {
  name: string
  description: string
  readOnly: boolean
  destructive: boolean
  exposed: boolean
}

export type TestResult = { ok: true; tools: ToolInfo[] } | { ok: false; error: string }

export type ImportPreview = {
  servers: { name: string; url: string }[]
  skipped: { name: string; reason: string }[]
  secretsToCreate: string[]
  secretsNeeded: string[]
  secretsEnabled: boolean
}

export type ImportApplied = {
  added: string[]
  updated: string[]
  skipped: { name: string; reason: string }[]
  secretsNeeded: string[]
}

type ExtensionsState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  config: ExtensionsConfig | null
}

export const useExtensions = create<ExtensionsState>(() => ({ status: 'idle', config: null }))

const BASE = `${API_ORIGIN}/chat/api/config`

const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await request(`${BASE}${path}`, {
    ...init,
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
  })
  return (await response.json()) as T
}

export const loadExtensions = async (): Promise<void> => {
  useExtensions.setState((state) => ({ status: state.config ? state.status : 'loading' }))
  try {
    const config = await call<ExtensionsConfig>('')
    useExtensions.setState({ status: 'ready', config })
  } catch {
    useExtensions.setState((state) => ({ status: state.config ? 'ready' : 'error' }))
    throw new Error('load')
  }
}

export const isConflict = (error: unknown) => error instanceof ApiError && error.status === 409

/** 整份保存。版本冲突时先刷新再抛出，让调用方提示用户重试。 */
export const saveExtensions = async (next: {
  mcpServers: McpServer[]
  skills: Skill[]
}): Promise<void> => {
  const config = useExtensions.getState().config
  if (!config) {
    throw new Error('not loaded')
  }
  try {
    await call('', { method: 'PUT', body: JSON.stringify({ version: config.version, ...next }) })
  } catch (error) {
    if (isConflict(error)) {
      await loadExtensions().catch(() => {})
    }
    throw error
  }
  await loadExtensions()
}

export const setSecret = async (name: string, value: string): Promise<void> => {
  await call(`/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })
}

export const removeSecret = async (name: string): Promise<void> => {
  await call(`/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export const testServer = async (id: string): Promise<TestResult> => {
  const result = await call<TestResult>(`/mcp/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    body: '{}',
  })
  await loadExtensions().catch(() => {})
  return result
}

export const previewMcpImport = (text: string) =>
  call<ImportPreview>('/import', { method: 'POST', body: JSON.stringify({ config: text }) })

export const applyMcpImport = async (text: string): Promise<ImportApplied> => {
  const config = useExtensions.getState().config
  if (!config) {
    throw new Error('not loaded')
  }
  try {
    const result = await call<ImportApplied>('/import', {
      method: 'POST',
      body: JSON.stringify({ config: text, apply: true, version: config.version }),
    })
    await loadExtensions().catch(() => {})
    return result
  } catch (error) {
    if (isConflict(error)) {
      await loadExtensions().catch(() => {})
    }
    throw error
  }
}

// ---------- 本地辅助 ----------

export const slugify = (raw: string, max = 32): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')

export const newServerId = (name: string): string => {
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
  return `${slugify(name, 20) || 'server'}-${rand}`
}

/** 令牌密钥名：由服务器 id 得到，只含字母、数字、下划线。 */
export const tokenSecretName = (serverId: string): string =>
  `MCP_${serverId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`.slice(0, 64)

const SECRET_REF = /\$\{secret:([A-Za-z0-9_]{1,64})\}/

/** 服务器当前的令牌密钥名；没有用 Authorization 引用密钥时为 null。 */
export const currentTokenSecret = (server: McpServer): string | null => {
  const key = Object.keys(server.headers).find((name) => name.toLowerCase() === 'authorization')
  const match = key ? SECRET_REF.exec(server.headers[key]) : null
  return match ? match[1] : null
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url.replace(/\$\{secret:[A-Za-z0-9_]+\}/g, 'x')).host
  } catch {
    return url
  }
}

const MAX_SKILL_BYTES = 5_000_000

/** 读 SKILL.md 开头的 frontmatter：支持单行值和 > / | 折叠块。 */
const parseFrontmatter = (text: string): { meta: Record<string, string>; body: string } => {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (!match) {
    return { meta: {}, body: normalized }
  }
  const meta: Record<string, string> = {}
  const lines = match[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i])
    if (!kv) {
      continue
    }
    let value = kv[2].trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        parts.push(lines[++i].trim())
      }
      value = parts.join(' ')
    }
    meta[kv[1].toLowerCase()] = value.replace(/^["']|["']$/g, '')
  }
  return { meta, body: normalized.slice(match[0].length) }
}

export type ParsedSkill = { name: string; description: string; body: string; ignored: number }

/** 从 .md 或 .zip 里取出 SKILL.md；zip 里的其他文件一律不读，只统计个数。 */
export const parseSkillFile = async (file: File): Promise<ParsedSkill | null> => {
  if (file.size > MAX_SKILL_BYTES) {
    return null
  }
  let text: string
  let ignored = 0
  let fallbackName = file.name.replace(/\.[^.]+$/, '')
  if (/\.zip$/i.test(file.name)) {
    let skillPath = ''
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        const isDir = entry.name.endsWith('/')
        const isSkill = /(^|\/)SKILL\.md$/i.test(entry.name) && entry.name.split('/').length <= 3
        if (isSkill && !skillPath) {
          skillPath = entry.name
          return entry.originalSize <= MAX_SKILL_BYTES
        }
        if (!isDir && !entry.name.startsWith('__MACOSX/')) {
          ignored += 1
        }
        return false
      },
    })
    const bytes = skillPath ? entries[skillPath] : undefined
    if (!bytes) {
      return null
    }
    text = strFromU8(bytes)
    const folder = skillPath.split('/').slice(-2, -1)[0]
    if (folder) {
      fallbackName = folder
    }
  } else {
    text = await file.text()
  }
  const { meta, body } = parseFrontmatter(text)
  const name = slugify(meta.name || fallbackName, 63)
  const firstLine = body
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  const description = (meta.description || firstLine || '').slice(0, 500)
  if (!name || !description || !body.trim()) {
    return null
  }
  return { name, description, body: body.trim(), ignored }
}
