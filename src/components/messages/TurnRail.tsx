import clsx from 'clsx'
import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import styles from './TurnRail.module.css'

export type Turn = { id: string; text: string }

/** 轮次过多时只挂载当前轮次附近的刻度 */
const WINDOW = 40

const preview = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

/**
 * 轮次导航条：贴在对话区右侧，每一轮提问一个刻度，当前阅读到的一轮高亮；
 * 悬停或聚焦时显示该轮提问的开头，点击跳转。宽度不足时由样式隐藏。
 */
export const TurnRail = memo(function TurnRail({
  turns,
  activeId,
  onJump,
}: {
  turns: Turn[]
  activeId: string | null
  onJump: (id: string) => void
}) {
  const t = useTranslate()
  if (turns.length < 3) {
    return null
  }
  const activeIndex = Math.max(
    0,
    turns.findIndex((turn) => turn.id === activeId)
  )
  const start = Math.min(Math.max(0, activeIndex - WINDOW / 2), Math.max(0, turns.length - WINDOW))
  const visible = turns.slice(start, start + WINDOW)
  return (
    <nav className={styles.rail} aria-label={t('turnRailLabel')}>
      {visible.map((turn, index) => {
        const active = start + index === activeIndex
        return (
          <button
            key={turn.id}
            type="button"
            className={clsx(styles.mark, active && styles.active)}
            aria-label={preview(turn.text) || t('turnRailLabel')}
            aria-current={active ? 'true' : undefined}
            onClick={() => onJump(turn.id)}
          >
            <span className={styles.tick} />
            <span className={styles.preview}>{preview(turn.text)}</span>
          </button>
        )
      })}
    </nav>
  )
})
