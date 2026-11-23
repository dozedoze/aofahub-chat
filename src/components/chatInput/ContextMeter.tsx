import clsx from 'clsx'
import { memo } from 'react'
import { shallow } from 'zustand/shallow'
import { useTranslate } from '../../i18n/index.js'
import { getContextUsage } from '../../services/chat/context.js'
import { useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { formatTokens } from '../../utils/format.js'
import { Tooltip } from '../base/Tooltip.js'
import styles from './ContextMeter.module.css'

const SIZE = 18
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** 上下文占用环：当前会话已用 token / 模型上下文窗口，悬停查看具体数值 */
export const ContextMeter = memo(function ContextMeter({
  sessionId,
}: {
  sessionId: string | null
}) {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const known = useSettings((state) => state.contextWindows)
  const { used, limit, percent } = useChatStore(
    (state) =>
      getContextUsage(sessionId === null ? undefined : state.sessionCache[sessionId], model, known),
    shallow
  )

  const label = t('contextUsage', {
    used: formatTokens(used),
    limit: formatTokens(limit),
    percent,
  })
  const tone = percent >= 95 ? styles.over : percent >= 80 ? styles.warn : null

  return (
    <Tooltip content={label}>
      <div className={clsx(styles.meter, tone)} role="img" aria-label={label}>
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
            strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        <span className={styles.text}>{Math.round(percent)}%</span>
      </div>
    </Tooltip>
  )
})
