import { useTranslate } from '../../i18n/index.js'
import { editQueued, removeQueued, selectQueue, useQueue } from '../../services/chat/queue.js'
import { IconCloseFill14, IconEditOutline16 } from '../base/icons.js'
import styles from './QueueChips.module.css'

/** 排队等待发送的消息：可取回编辑或取消 */
export const QueueChips = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const queue = useQueue(selectQueue(sessionId))
  if (sessionId === null || queue.length === 0) {
    return null
  }
  return (
    <ul className={styles.list} aria-label={t('queueLabel')}>
      {queue.map((item) => (
        <li key={item.id} className={styles.chip}>
          <span className={styles.badge}>{t('queueWaiting')}</span>
          <span className={styles.text}>{item.text}</span>
          <button
            type="button"
            className={styles.action}
            aria-label={t('queueEdit')}
            title={t('queueEdit')}
            onClick={() => editQueued(sessionId, item.id)}
          >
            <IconEditOutline16 />
          </button>
          <button
            type="button"
            className={styles.action}
            aria-label={t('queueCancel')}
            title={t('queueCancel')}
            onClick={() => removeQueued(sessionId, item.id)}
          >
            <IconCloseFill14 />
          </button>
        </li>
      ))}
    </ul>
  )
}
