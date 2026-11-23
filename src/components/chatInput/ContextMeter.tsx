import clsx from 'clsx'
import { memo } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  getContextUsage,
  isSameContextUsage,
  type ContextSegmentKey,
} from '../../services/chat/context.js'
import type { DraftAttachment } from '../../services/chat/drafts.js'
import { useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { formatTokens } from '../../utils/format.js'
import { HoverCard, type HoverCardTrigger } from '../search/HoverCard.js'
import styles from './ContextMeter.module.css'

const SIZE = 18
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const SEGMENT_LABELS: Record<ContextSegmentKey, TranslationKey> = {
  server: 'contextSegmentServer',
  system: 'contextSegmentSystem',
  user: 'contextSegmentUser',
  attachments: 'contextSegmentAttachments',
  assistant: 'contextSegmentAssistant',
  web: 'contextSegmentWeb',
  thinking: 'contextSegmentThinking',
  draft: 'contextSegmentDraft',
}

/** 小数位随占比变化：很小的占比保留一位，避免显示成 0 */
const formatPercent = (value: number) =>
  value > 0 && value < 10 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`

/**
 * 上下文占用环：当前会话已用 token / 模型上下文窗口。
 * 悬停展开分项（服务端附加、提问、附件、回复……），数据来自本机已保存的消息。
 */
export const ContextMeter = memo(function ContextMeter({
  sessionId,
  draftText,
  draftAttachments,
}: {
  sessionId: string | null
  draftText: string
  draftAttachments: DraftAttachment[]
}) {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const known = useSettings((state) => state.contextWindows)
  const usage = useChatStore(
    (state) =>
      getContextUsage(
        sessionId === null ? undefined : state.sessionCache[sessionId],
        model,
        known,
        {
          text: draftText,
          files: draftAttachments.map(({ file, isImage }) => ({ isImage, size: file.size })),
        }
      ),
    isSameContextUsage
  )
  const { used, limit, percent, segments } = usage
  const prefix = usage.estimated ? '~' : ''

  const label = t('contextUsage', {
    used: `${prefix}${formatTokens(used)}`,
    limit: formatTokens(limit),
    percent,
  })
  // 占用很小时圆环几乎看不见：有用量就至少画出一小段。
  const arc = used > 0 ? Math.max(percent, 4) : 0
  const tone = percent >= 95 ? styles.over : percent >= 80 ? styles.warn : null

  const renderTrigger: HoverCardTrigger = ({ domRef, domProps }) => (
    <span
      ref={domRef}
      className={clsx(styles.meter, tone)}
      role="img"
      aria-label={label}
      {...domProps}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        <circle
          className={styles.track}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
        />
        <circle
          className={styles.fill}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - arc / 100)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      <span className={styles.text}>{formatPercent(percent)}</span>
    </span>
  )

  return (
    <HoverCard renderTrigger={renderTrigger} side="top">
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.title}>{t('contextTitle')}</span>
          {usage.estimated ? <span className={styles.badge}>{t('contextEstimated')}</span> : null}
        </div>
        <div className={styles.total}>
          <span className={styles.used}>
            {prefix}
            {formatTokens(used)}
          </span>
          <span className={styles.limit}>
            / {formatTokens(limit)} · {formatPercent(percent)}
          </span>
        </div>
        <div className={styles.bar} aria-hidden>
          {segments.map(({ key, tokens }) => (
            <span
              key={key}
              className={clsx(styles.slice, styles[key])}
              style={{ width: `${(tokens / Math.max(used, limit)) * 100}%` }}
            />
          ))}
        </div>
        <ul className={styles.list}>
          {segments.map(({ key, tokens }) => (
            <li key={key} className={styles.row}>
              <span className={clsx(styles.dot, styles[key])} />
              <span className={styles.name}>{t(SEGMENT_LABELS[key])}</span>
              <span className={styles.count}>
                {formatTokens(tokens)}
                <span className={styles.share}>{formatPercent((tokens / used) * 100)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={styles.note}>{t('contextHint')}</p>
        {usage.windowKnown ? null : <p className={styles.note}>{t('contextWindowGuess')}</p>}
      </div>
    </HoverCard>
  )
})
