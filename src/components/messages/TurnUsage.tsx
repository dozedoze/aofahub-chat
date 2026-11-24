import { useTranslate } from '../../i18n/index.js'
import { getTurnUsage } from '../../services/chat/usageStats.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import styles from './TurnUsage.module.css'

const formatCount = (value: number) => value.toLocaleString()

/** 一条回答的用量明细：输入/输出 Token、缓存命中率、输出速度 */
export const TurnUsage = ({ message }: { message: AssistantMessage }) => {
  const t = useTranslate()
  const stats = getTurnUsage(message)
  if (!stats) {
    return null
  }
  return (
    <dl className={styles.usage}>
      <div className={styles.item}>
        <dt>{t('turnUsageInput')}</dt>
        <dd>{formatCount(stats.inputTokens)}</dd>
      </div>
      {stats.cacheHit !== null && stats.cacheHit > 0 ? (
        <div className={styles.item}>
          <dt>{t('turnUsageCache')}</dt>
          <dd>{Math.round(stats.cacheHit * 100)}%</dd>
        </div>
      ) : null}
      <div className={styles.item}>
        <dt>{t('turnUsageOutput')}</dt>
        <dd>{formatCount(stats.outputTokens)}</dd>
      </div>
      {stats.speed !== null ? (
        <div className={styles.item}>
          <dt>{t('turnUsageSpeed')}</dt>
          <dd>{t('turnUsageSpeedValue', { value: stats.speed.toFixed(1) })}</dd>
        </div>
      ) : null}
    </dl>
  )
}
