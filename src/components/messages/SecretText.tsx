import { memo, useMemo, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { findSecrets } from '../../utils/secrets.js'
import { IconEyeOffOutline16, IconEyeOutline16 } from '../base/icons.js'
import styles from './SecretText.module.css'

/**
 * 用户消息正文：把疑似凭据遮住，点击眼睛按钮可单独显示某一段。
 * 只影响显示，复制、编辑与发给模型的仍是原文。
 */
export const SecretText = memo(function SecretText({ text }: { text: string }) {
  const t = useTranslate()
  const runs = useMemo(() => findSecrets(text), [text])
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set())

  if (runs.length === 0) {
    return text
  }

  const toggle = (start: number) =>
    setRevealed((current) => {
      const next = new Set(current)
      if (!next.delete(start)) {
        next.add(start)
      }
      return next
    })

  const parts: ReactNode[] = []
  let at = 0
  for (const run of runs) {
    if (run.start > at) {
      parts.push(text.slice(at, run.start))
    }
    const shown = revealed.has(run.start)
    parts.push(
      <span key={run.start} className={styles.secret}>
        <span className={styles.value}>{shown ? text.slice(run.start, run.end) : run.masked}</span>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={shown}
          aria-label={t(shown ? 'secretHide' : 'secretReveal')}
          title={t(shown ? 'secretHide' : 'secretReveal')}
          onClick={() => toggle(run.start)}
        >
          {shown ? <IconEyeOffOutline16 /> : <IconEyeOutline16 />}
        </button>
      </span>
    )
    at = run.end
  }
  if (at < text.length) {
    parts.push(text.slice(at))
  }
  return parts
})
