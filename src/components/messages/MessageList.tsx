import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { QuoteSelection } from './QuoteSelection.js'
import { setScrollAtBottom, useScrollState } from './scrollState.js'
import { TurnRail, type Turn } from './TurnRail.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
/** 末尾这些条消息始终完整渲染，更早的交给浏览器按可见性跳过渲染 */
const ALWAYS_RENDERED = 6
/** 阅读基准线：滚动容器顶部往下这么远，作为「当前读到哪一轮」的判断位置 */
const READING_LINE = 120
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const frameRef = useRef(0)
  const messages = getVisibleMessages(session)
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id
  const turns = useMemo<Turn[]>(
    () =>
      messages.flatMap((message) =>
        message.role === 'user' ? [{ id: message.id, text: message.content }] : []
      ),
    [messages]
  )
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  const activeTurnIdRef = useRef(activeTurnId)
  activeTurnIdRef.current = activeTurnId

  /** 跟随状态变化时同步给「回到底部」按钮 */
  const setSticky = useCallback((value: boolean) => {
    stickyRef.current = value
    setScrollAtBottom(value)
  }, [])

  /** 阅读基准线之上最近的一条提问：二分查找，只读 O(log n) 个元素的位置 */
  const readActiveTurn = useCallback(() => {
    const scroll = scrollRef.current
    const column = contentRef.current
    if (!scroll || !column) {
      return
    }
    const items = column.children
    const line = scroll.getBoundingClientRect().top + READING_LINE
    let low = 0
    let high = items.length - 1
    let found = 0
    while (low <= high) {
      const mid = (low + high) >> 1
      if (items[mid].getBoundingClientRect().top <= line) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    for (let index = found; index >= 0; index--) {
      const element = items[index] as HTMLElement
      if (element.dataset.role === 'user') {
        setActiveTurnId(element.dataset.messageId ?? null)
        return
      }
    }
    setActiveTurnId(turnsRef.current[0]?.id ?? null)
  }, [])

  const scheduleActiveTurn = useCallback(() => {
    if (frameRef.current === 0) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        readActiveTurn()
      })
    }
  }, [readActiveTurn])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    setSticky(true)
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom, setSticky])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      setSticky(false)
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming, setSticky]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        setSticky(true)
      } else if (el.scrollTop < scrollTopRef.current) {
        setSticky(false)
      }
      scrollTopRef.current = el.scrollTop
      scheduleActiveTurn()
    }
    // 滚轮、键盘上滚在 scroll 事件之前就停止跟随，避免流式内容增高把用户拽回底部。
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        setSticky(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      if (!editing && ['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
        setSticky(false)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    document.addEventListener('keydown', onKeyDown)
    scheduleActiveTurn()
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isMobile, scrollToBottom, setSticky, scheduleActiveTurn])

  // 新增轮次或切换会话后重新判断当前读到的一轮
  useEffect(scheduleActiveTurn, [session.id, turns.length, scheduleActiveTurn])
  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const jumpToTurn = useCallback(
    (id: string) => {
      const scroll = scrollRef.current
      const column = contentRef.current
      const target = column?.querySelector<HTMLElement>(
        `[data-role="user"][data-message-id="${CSS.escape(id)}"]`
      )
      if (!scroll || !target) {
        return
      }
      setSticky(false)
      const delta = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24
      scroll.scrollTo({
        top: scroll.scrollTop + delta,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
      setActiveTurnId(id)
    },
    [setSticky]
  )

  // 登记给「回到底部」按钮与 Alt+↑/↓ 快捷键使用的动作
  useEffect(() => {
    const jumpToBottom = () => {
      const scroll = scrollRef.current
      if (!scroll) {
        return
      }
      setSticky(true)
      scroll.scrollTo({
        top: scroll.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    }
    const jumpTurn = (delta: 1 | -1) => {
      const list = turnsRef.current
      if (list.length === 0) {
        return
      }
      if (delta === 1 && activeTurnIdRef.current === list.at(-1)?.id) {
        jumpToBottom()
        return
      }
      const current = list.findIndex((turn) => turn.id === activeTurnIdRef.current)
      const next = Math.min(
        list.length - 1,
        Math.max(0, (current === -1 ? list.length : current) + delta)
      )
      jumpToTurn(list[next].id)
    }
    useScrollState.setState({ jumpToBottom, jumpTurn })
    return () => {
      useScrollState.setState({ jumpToBottom: () => {}, jumpTurn: () => {}, atBottom: true })
    }
  }, [jumpToTurn, setSticky])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
          <div ref={contentRef} className={styles.column}>
            {messages.map((message, index) => (
              <div
                key={message.id}
                data-message-id={message.id}
                data-role={message.role}
                className={clsx(
                  styles.item,
                  index < lastIndex - ALWAYS_RENDERED && styles.deferred
                )}
              >
                {message.role === 'user' ? (
                  <UserMessage
                    sessionId={session.id}
                    message={message}
                    retryUploadId={uploadRetryId}
                    isFirst={index === 0}
                    isLast={index === lastIndex || index === lastIndex - 1}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                ) : (
                  <AssistantMessage
                    sessionId={session.id}
                    message={message}
                    isLast={index === lastIndex}
                    streaming={streaming && index === lastIndex}
                    busy={streaming}
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        {footer}
      </div>
      {isMobile ? null : <TurnRail turns={turns} activeId={activeTurnId} onJump={jumpToTurn} />}
      <QuoteSelection sessionId={session.id} containerRef={scrollRef} />
    </ScrollToBottomContext.Provider>
  )
}
