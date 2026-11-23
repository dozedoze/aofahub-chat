import { create } from 'zustand'

export const API_ORIGIN = __API_ORIGIN__

export type ChatUser = { username: string }

export const useAuth = create<{ status: 'loading' | 'anon' | 'in'; username: string | null }>(
  () => ({
    status: 'loading',
    username: null,
  })
)

export const expireSession = () => {
  useAuth.setState({ status: 'anon', username: null })
}

export async function fetchMe(): Promise<ChatUser | null> {
  const response = await fetch(`${API_ORIGIN}/chat/api/me`, { credentials: 'include' })
  if (response.status === 401) {
    return null
  }
  if (!response.ok) {
    throw new Error(`session ${response.status}`)
  }
  return (await response.json()) as ChatUser
}

export async function bootstrapAuth(): Promise<void> {
  try {
    const user = await fetchMe()
    useAuth.setState(
      user ? { status: 'in', username: user.username } : { status: 'anon', username: null }
    )
  } catch {
    useAuth.setState({ status: 'anon', username: null })
  }
}

export class LoginError extends Error {
  readonly status?: number
  readonly retryAfter?: number

  constructor(message: string, status?: number, retryAfter?: number) {
    super(message)
    this.name = 'LoginError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

const readRetryAfter = (response: Response, error: { retry_after?: unknown }): number | undefined => {
  if (typeof error.retry_after === 'number' && Number.isFinite(error.retry_after) && error.retry_after > 0) {
    return Math.ceil(error.retry_after)
  }
  const header = Number(response.headers.get('retry-after'))
  return Number.isFinite(header) && header > 0 ? Math.ceil(header) : undefined
}

export async function login(username: string, password: string): Promise<ChatUser> {
  const response = await fetch(`${API_ORIGIN}/chat/api/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = (await response.json().catch(() => ({}))) as {
    username?: string
    error?: { message?: string; retry_after?: unknown }
  }
  if (!response.ok) {
    throw new LoginError(
      data.error?.message || 'Invalid username or password',
      response.status,
      readRetryAfter(response, data.error ?? {})
    )
  }
  const user = { username: data.username || username }
  useAuth.setState({ status: 'in', username: user.username })
  return user
}

export type UsageCall = { at: number; model: string; provider: string; tokens: number }

export type UsageSnapshot = {
  usedTokens: number
  quotaTokens: number
  remainingTokens: number | null
  requestCount: number
  percent: number | null
  recent: UsageCall[]
}

export async function fetchUsage(): Promise<UsageSnapshot> {
  const response = await fetch(`${API_ORIGIN}/chat/api/usage`, { credentials: 'include' })
  if (response.status === 401) {
    expireSession()
    throw new Error('unauthorized')
  }
  if (!response.ok) {
    throw new Error(`usage ${response.status}`)
  }
  const data = (await response.json()) as Partial<UsageSnapshot> & { ok?: boolean }
  const usedTokens = typeof data.usedTokens === 'number' ? data.usedTokens : 0
  const quotaTokens = typeof data.quotaTokens === 'number' ? data.quotaTokens : 0
  const requestCount = typeof data.requestCount === 'number' ? data.requestCount : 0
  const remainingTokens =
    typeof data.remainingTokens === 'number' || data.remainingTokens === null
      ? data.remainingTokens
      : quotaTokens === 0
        ? null
        : Math.max(0, quotaTokens - usedTokens)
  const percent =
    typeof data.percent === 'number' || data.percent === null
      ? data.percent
      : quotaTokens === 0
        ? null
        : Math.min(100, Math.round((usedTokens / quotaTokens) * 1000) / 10)
  return {
    usedTokens,
    quotaTokens,
    remainingTokens,
    requestCount,
    percent,
    recent: Array.isArray(data.recent) ? data.recent : [],
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_ORIGIN}/chat/api/logout`, { method: 'POST', credentials: 'include' })
  } catch {
    /* ignore */
  }
  expireSession()
}

export type ModelCatalog = { ids: string[]; contextWindows: Record<string, number> }

const readContextWindow = (item: Record<string, unknown>): number | null => {
  for (const key of ['context_length', 'context_window', 'max_input_tokens', 'max_context_length']) {
    const value = item[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value)
    }
  }
  return null
}

export async function fetchModels(): Promise<ModelCatalog> {
  const response = await fetch(`${API_ORIGIN}/models`, { credentials: 'include' })
  if (!response.ok) {
    return { ids: ['auto'], contextWindows: {} }
  }
  const body = (await response.json()) as { data?: Record<string, unknown>[] }
  const ids: string[] = []
  const contextWindows: Record<string, number> = {}
  for (const item of body.data ?? []) {
    if (typeof item.id !== 'string' || !item.id) {
      continue
    }
    ids.push(item.id)
    const windowSize = readContextWindow(item)
    if (windowSize) {
      contextWindows[item.id] = windowSize
    }
  }
  return { ids: ids.length ? ids : ['auto'], contextWindows }
}

export const isDeepseekModel = (model: string) => /deepseek/i.test(model)
