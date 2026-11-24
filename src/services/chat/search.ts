import * as db from './db.js'
import type { Message, SessionSummary } from './types.js'

export type SessionHit = {
  session: SessionSummary
  /** 命中在标题里 */
  inTitle: boolean
  /** 命中在正文里时的上下文片段，已按命中位置截取 */
  snippet: { before: string; match: string; after: string } | null
}

/** 提问与回答正文；不含思考与工具块 */
const messageText = (message: Message): string =>
  message.role === 'user'
    ? message.content
    : message.blocks
        .map((block) => (block.type === 'text' && !block.isTemplate ? block.text : ''))
        .join('\n')

/** 会话正文的小写化缓存，会话更新后按 updatedAt 失效 */
const textCache = new Map<string, { updatedAt: number; text: string; raw: string }>()

const MAX_CACHE = 300
/** 正文搜索最多读取的会话数，按最近更新排序，避免历史很多时一次读完整个库 */
const MAX_SCAN = 200
const SNIPPET_RADIUS = 28

const loadText = async (summary: SessionSummary) => {
  const cached = textCache.get(summary.id)
  if (cached && cached.updatedAt === summary.updatedAt) {
    return cached
  }
  const session = await db.loadSession(summary.id)
  const raw = session ? session.messages.map(messageText).join('\n') : ''
  const entry = { updatedAt: summary.updatedAt, raw, text: raw.toLowerCase() }
  if (textCache.size >= MAX_CACHE) {
    textCache.delete(textCache.keys().next().value as string)
  }
  textCache.set(summary.id, entry)
  return entry
}

const makeSnippet = (raw: string, index: number, length: number) => {
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = Math.min(raw.length, index + length + SNIPPET_RADIUS)
  const collapse = (value: string) => value.replace(/\s+/g, ' ')
  return {
    before: (start > 0 ? '…' : '') + collapse(raw.slice(start, index)),
    match: collapse(raw.slice(index, index + length)),
    after: collapse(raw.slice(index + length, end)) + (end < raw.length ? '…' : ''),
  }
}

/**
 * 在标题与正文里搜索会话。标题命中立即可得；正文需要从 IndexedDB 读取，
 * 逐个会话读取并在 `signal` 中止（输入变化或关闭弹窗）时停止。
 * 结果按「标题命中优先，其次最近更新」排序，`onUpdate` 每发现新命中就回调一次完整结果。
 */
export const searchSessions = async (
  query: string,
  sessions: readonly SessionSummary[],
  signal: AbortSignal,
  onUpdate: (hits: SessionHit[]) => void
): Promise<void> => {
  const keyword = query.trim().toLowerCase()
  if (!keyword) {
    onUpdate([])
    return
  }
  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const hits = new Map<string, SessionHit>()
  const publish = () =>
    onUpdate(
      [...hits.values()].sort(
        (a, b) => Number(b.inTitle) - Number(a.inTitle) || b.session.updatedAt - a.session.updatedAt
      )
    )
  for (const session of ordered) {
    if (session.title.toLowerCase().includes(keyword)) {
      hits.set(session.id, { session, inTitle: true, snippet: null })
    }
  }
  publish()
  for (const session of ordered.slice(0, MAX_SCAN)) {
    if (signal.aborted) {
      return
    }
    let entry
    try {
      entry = await loadText(session)
    } catch {
      continue
    }
    if (signal.aborted) {
      return
    }
    const index = entry.text.indexOf(keyword)
    if (index === -1) {
      continue
    }
    const snippet = makeSnippet(entry.raw, index, keyword.length)
    const existing = hits.get(session.id)
    hits.set(session.id, { session, inTitle: existing?.inTitle ?? false, snippet })
    publish()
  }
}
