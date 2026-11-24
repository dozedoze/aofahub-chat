import { useTranslate } from '../../i18n/index.js'
import { memo, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Prism from 'prismjs'
import {
  getHighlightLang,
  isHighlightLoaded,
  loadHighlight,
} from '../../services/markdown/highlight.js'
import { IconCheckOutline16, IconCopyOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { copyText } from '../../utils/clipboard.js'
import { MermaidDiagram } from './MermaidDiagram.js'
import styles from './CodeBlock.module.css'

/** 代码块标题栏：左侧语言名，右侧复制 */
const CodeInfoRow = ({
  code,
  infostring,
  showDiagram,
  onToggleDiagram,
}: {
  code: string
  infostring: string
  showDiagram: boolean
  onToggleDiagram?: () => void
}) => {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)
  return (
    <div className={styles.container}>
      {onToggleDiagram ? (
        <div className="md-code-block-switch" aria-label={t('mermaidSwitchLabel')}>
          <button
            type="button"
            className={styles.button}
            aria-pressed={showDiagram}
            onClick={() => !showDiagram && onToggleDiagram()}
          >
            {t('mermaidDiagram')}
          </button>
          <button
            type="button"
            className={styles.button}
            aria-pressed={!showDiagram}
            onClick={() => showDiagram && onToggleDiagram()}
          >
            {t('mermaidCode')}
          </button>
        </div>
      ) : (
        <span className={styles.name}>{infostring}</span>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={async () => {
          if (!(await copyText(code))) {
            showToast({ key: 'copyFailed' })
            return
          }
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        <span>{t(copied ? 'copied' : 'copy')}</span>
      </button>
    </div>
  )
}

/** 流式中超过这个长度才分组高亮；短代码整段高亮，颜色不会在结束时跳变 */
const CHUNK_THRESHOLD = 3000
/** 每组的行数；已完成的整组高亮后不再重算 */
const CHUNK_LINES = 60

type ChunkCache = { lang: string; source: string; html: string[] }

/**
 * 流式增量高亮：只高亮已完成的行，每满一组就固定下来复用，当前未写完的行按纯文本接在后面。
 * 每次追加的耗时只跟尾部长度有关。分组之间不传递语法状态，跨组的多行注释在流式中可能暂时着色不准，
 * 结束后整段重新高亮会修正。
 */
const highlightChunked = (code: string, lang: string, cache: ChunkCache | null) => {
  const base = cache && cache.lang === lang && code.startsWith(cache.source) ? cache : null
  const html = base ? [...base.html] : []
  let source = base ? base.source : ''
  const lines = code.slice(source.length).split('\n')
  const partial = lines.pop() ?? ''
  while (lines.length >= CHUNK_LINES) {
    const text = lines.splice(0, CHUNK_LINES).join('\n') + '\n'
    html.push(Prism.highlight(text, Prism.languages[lang], lang))
    source += text
  }
  const rest = lines.length > 0 ? lines.join('\n') + '\n' : ''
  const tail = rest ? Prism.highlight(rest, Prism.languages[lang], lang) : ''
  const escaped = partial.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return { cache: { lang, source, html }, html: html.join('') + tail + escaped }
}

/** 代码块：语言包按需加载，不支持或尚未加载的语言按纯文本显示 */
export const CodeBlock = memo(function CodeBlock({
  code,
  infostring,
  loading = false,
}: {
  code: string
  infostring: string
  loading?: boolean
}) {
  const isMermaid = infostring.toLowerCase() === 'mermaid'
  const [showDiagram, setShowDiagram] = useState(true)
  // 语言包注册在全局 Prism 上，每次渲染直接判断；加载完成后触发一次重渲染
  const rerender = useReducer((n: number) => n + 1, 0)[1]
  const lang = getHighlightLang(infostring)
  const loaded = lang !== null && isHighlightLoaded(lang)
  useEffect(() => {
    if (lang === null || loaded) {
      return
    }
    let unmounted = false
    loadHighlight(lang).then(() => {
      if (!unmounted) {
        rerender()
      }
    })
    return () => {
      unmounted = true
    }
  }, [lang, loaded, rerender])
  const chunkRef = useRef<ChunkCache | null>(null)
  const renderedHtml = useMemo(() => {
    const name = lang !== null && loaded ? lang : 'plaintext'
    if (loading && code.length > CHUNK_THRESHOLD) {
      const result = highlightChunked(code, name, chunkRef.current)
      chunkRef.current = result.cache
      return result.html
    }
    chunkRef.current = null
    return Prism.highlight(code, Prism.languages[name], name)
  }, [code, lang, loaded, loading])
  return (
    <div className="md-code-block">
      <div className="md-code-block-banner">
        <CodeInfoRow
          code={code}
          infostring={infostring}
          showDiagram={showDiagram}
          onToggleDiagram={isMermaid ? () => setShowDiagram((show) => !show) : undefined}
        />
      </div>
      {isMermaid && showDiagram ? (
        <MermaidDiagram code={code} loading={loading} />
      ) : (
        <pre dangerouslySetInnerHTML={{ __html: renderedHtml }}></pre>
      )}
    </div>
  )
})
