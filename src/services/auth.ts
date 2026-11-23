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

export async function login(username: string, password: string): Promise<ChatUser> {
  const response = await fetch(`${API_ORIGIN}/chat/api/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = (await response.json().catch(() => ({}))) as {
    username?: string
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(data.error?.message || 'Invalid username or password')
  }
  const user = { username: data.username || username }
  useAuth.setState({ status: 'in', username: user.username })
  return user
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_ORIGIN}/chat/api/logout`, { method: 'POST', credentials: 'include' })
  } catch {
    /* ignore */
  }
  expireSession()
}

export async function fetchModels(): Promise<string[]> {
  const response = await fetch(`${API_ORIGIN}/models`, { credentials: 'include' })
  if (!response.ok) {
    return ['auto']
  }
  const body = (await response.json()) as { data?: { id?: string }[] }
  const ids = (body.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id))
  return ids.length ? ids : ['auto']
}

export const isDeepseekModel = (model: string) => /deepseek/i.test(model)
