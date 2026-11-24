import { memo, useMemo, useRef } from 'react'
import type { Source } from '../../services/chat/view.js'
import { toMdAstIncremental, type IncrementalState } from '../../services/markdown/parse.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import './markdown.css'
import './highlight.css'

/**
 * 渲染链路：节流 → 增量解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
}) {
  const scrollToBottom = useScrollToBottom()
  const throttledMarkdown = useThrottleMarkdownRender(content, loading)
  // 流式时只重新解析末尾：已完成的块冻结，对象不变，渲染层跳过它们。
  const incrementalRef = useRef<IncrementalState | null>(null)
  const ast = useMemo(() => {
    if (!throttledMarkdown) {
      incrementalRef.current = null
      return null
    }
    const result = toMdAstIncremental(
      throttledMarkdown,
      { sources, disableLink },
      incrementalRef.current
    )
    incrementalRef.current = result.state
    return result.ast
  }, [throttledMarkdown, sources, disableLink])
  return ast ? (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      ast={ast}
      loading={loading}
      onUpdate={scrollToBottom}
    />
  ) : null
})
