import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { getDraft, setDraftText } from '../../services/chat/drafts.js'
import { IconQuoteOutline16 } from '../base/icons.js'
import styles from './QuoteSelection.module.css'

type Anchor = { x: number; y: number; text: string }

const MAX_QUOTE_CHARS = 4000

/** 把选中的文字作为 Markdown 引用追加到输入框草稿末尾，并把光标留在引用之后。 */
export const quoteIntoDraft = (sessionId: string | null, text: string) => {
  const body = text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS)}…` : text
  const quoted = body
    .split(/\r?\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')
  const previous = getDraft(sessionId).text
  const gap = !previous
    ? ''
    : previous.endsWith('\n\n')
      ? ''
      : previous.endsWith('\n')
        ? '\n'
        : '\n\n'
  const next = `${previous}${gap}${quoted}\n\n`
  setDraftText(sessionId, next)
  requestAnimationFrame(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]')
    textarea?.focus({ preventScroll: true })
    textarea?.setSelectionRange(next.length, next.length)
  })
}

const readSelection = (container: HTMLElement | null): Anchor | null => {
  const selection = document.getSelection()
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  const node = range.commonAncestorContainer
  const element = node instanceof Element ? node : node.parentElement
  const host = element?.closest('[data-quotable]')
  const text = selection.toString().trim()
  if (!host || !container.contains(host) || !text) {
    return null
  }
  const rects = range.getClientRects()
  const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
  return { x: rect.right, y: rect.bottom, text }
}

/**
 * 选中回答或提问里的文字后，在选区末尾浮出「引用」按钮，点击把选中内容引用到输入框继续追问。
 * 只在鼠标松开或键盘选择结束后出现，拖选过程中不打扰；选区消失时收起。
 */
export const QuoteSelection = ({
  sessionId,
  containerRef,
}: {
  sessionId: string
  containerRef: RefObject<HTMLElement | null>
}) => {
  const t = useTranslate()
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    const refresh = () => setAnchor(readSelection(containerRef.current))
    const onDown = (event: PointerEvent) => {
      // 点在按钮上不能让选区消失。
      if (event.target instanceof Element && event.target.closest('[data-quote-button]')) {
        return
      }
      draggingRef.current = true
      setAnchor(null)
    }
    const onUp = () => {
      draggingRef.current = false
      // 等浏览器把选区更新完再读。
      requestAnimationFrame(refresh)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === 'Shift') {
        refresh()
      }
    }
    const onChange = () => {
      if (!draggingRef.current && document.getSelection()?.isCollapsed) {
        setAnchor(null)
      }
    }
    const hide = () => setAnchor(null)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('selectionchange', onChange)
    window.addEventListener('resize', hide)
    const container = containerRef.current
    container?.addEventListener('scroll', hide, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('selectionchange', onChange)
      window.removeEventListener('resize', hide)
      container?.removeEventListener('scroll', hide)
    }
  }, [containerRef])

  if (!anchor) {
    return null
  }
  const left = Math.min(Math.max(8, anchor.x - 28), window.innerWidth - 80)
  const top = Math.min(anchor.y + 8, window.innerHeight - 44)
  return createPortal(
    <button
      type="button"
      data-quote-button
      className={styles.button}
      style={{ left, top }}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        quoteIntoDraft(sessionId, anchor.text)
        document.getSelection()?.removeAllRanges()
        setAnchor(null)
      }}
    >
      <IconQuoteOutline16 />
      <span>{t('quoteAction')}</span>
    </button>,
    document.body
  )
}
