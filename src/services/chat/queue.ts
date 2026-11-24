import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { getVisibleMessages } from './branches.js'
import { getDraft, setDraftText } from './drafts.js'
import { sendMessage, useChatStore } from './store.js'

/**
 * 排队发送：回答生成中输入的文字先排在队列里，本轮正常结束后自动依次发出。
 * 只排纯文字；队列只在本次页面的内存中，刷新后丢弃。
 */
export type QueuedMessage = { id: string; text: string }

const EMPTY: QueuedMessage[] = []

export const useQueue = create<{ queues: Record<string, QueuedMessage[]> }>(() => ({
  queues: {},
}))

export const selectQueue =
  (sessionId: string | null) => (state: { queues: Record<string, QueuedMessage[]> }) =>
    (sessionId === null ? undefined : state.queues[sessionId]) ?? EMPTY

const setQueue = (sessionId: string, update: (queue: QueuedMessage[]) => QueuedMessage[]) =>
  useQueue.setState((state) => {
    const next = update(state.queues[sessionId] ?? EMPTY)
    const rest = Object.entries(state.queues).filter(([id]) => id !== sessionId)
    return { queues: Object.fromEntries(next.length > 0 ? [...rest, [sessionId, next]] : rest) }
  })

export const enqueueMessage = (sessionId: string, text: string) => {
  const trimmed = text.trim()
  if (trimmed) {
    setQueue(sessionId, (queue) => [...queue, { id: createId(), text: trimmed }])
  }
}

export const removeQueued = (sessionId: string, id: string) =>
  setQueue(sessionId, (queue) => queue.filter((item) => item.id !== id))

/** 取回排队的文字放回输入框；输入框已有内容时接在后面，不覆盖用户正在写的。 */
export const editQueued = (sessionId: string, id: string) => {
  const item = (useQueue.getState().queues[sessionId] ?? EMPTY).find((entry) => entry.id === id)
  if (!item) {
    return
  }
  const current = getDraft(sessionId).text
  setDraftText(sessionId, current ? `${item.text}\n${current}` : item.text)
  removeQueued(sessionId, id)
}

/** 立即发出排队的第一条；输入框里正在写的文字原样保留。成功返回 true。 */
export const sendNextQueued = (sessionId: string): boolean => {
  const next = (useQueue.getState().queues[sessionId] ?? EMPTY)[0]
  if (!next) {
    return false
  }
  const previous = getDraft(sessionId)
  // 输入框里已有附件时一起发出会带走用户没打算发的文件，这种情况留给用户自己处理。
  if (previous.attachments.length > 0) {
    return false
  }
  setDraftText(sessionId, next.text)
  if (!sendMessage(sessionId)) {
    setDraftText(sessionId, previous.text)
    return false
  }
  setQueue(sessionId, (queue) => queue.filter((item) => item.id !== next.id))
  if (previous.text) {
    setDraftText(sessionId, previous.text)
  }
  return true
}

/** 某个对话刚结束一轮回答且正常完成（不是停止或出错）时，自动发出队列里的下一条。 */
export const bindQueue = () =>
  useChatStore.subscribe((state, previous) => {
    for (const sessionId of Object.keys(previous.streaming)) {
      if (Object.hasOwn(state.streaming, sessionId) || !(sessionId in useQueue.getState().queues)) {
        continue
      }
      const session = Object.hasOwn(state.sessionCache, sessionId)
        ? state.sessionCache[sessionId]
        : undefined
      const last = session ? getVisibleMessages(session).at(-1) : undefined
      if (last?.role === 'assistant' && last.status === 'done') {
        // 等当前 set 完成后再发，避免在订阅回调里再触发状态更新。
        queueMicrotask(() => sendNextQueued(sessionId))
      }
    }
  })
