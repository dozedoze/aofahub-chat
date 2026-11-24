import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { searchSessions, type SessionHit } from '../../services/chat/search.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { Modal } from '../base/Modal.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'
import { closeSessionSearch, useOverlays } from './shortcutsState.js'
import styles from './SessionSearch.module.css'

/** 输入停顿多久后开始读取正文，避免每个字符都扫一遍库 */
const DEBOUNCE_MS = 180

export const SessionSearch = () => {
  const open = useOverlays((state) => state.search)
  return open ? <Content /> : null
}

const Content = () => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SessionHit[]>([])
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const keyword = query.trim()
    setActive(0)
    if (!keyword) {
      setHits([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      void searchSessions(keyword, sessionsRef.current, controller.signal, (next) => {
        if (!controller.signal.aborted) {
          setHits(next)
        }
      }).finally(() => {
        if (!controller.signal.aborted) {
          setSearching(false)
        }
      })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const choose = (hit: SessionHit | undefined) => {
    if (!hit) {
      return
    }
    selectSession(hit.session.id)
    closeMobileSider()
    closeSessionSearch()
  }

  return (
    <Modal
      title={t('sessionSearchTitle')}
      closable
      className={styles.dialog}
      onClose={closeSessionSearch}
    >
      <input
        className={styles.input}
        autoFocus
        value={query}
        placeholder={t('sessionSearchPlaceholder')}
        aria-label={t('sessionSearchPlaceholder')}
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls="session-search-results"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((value) => Math.min(hits.length - 1, value + 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((value) => Math.max(0, value - 1))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            choose(hits[active])
          }
        }}
      />
      <ul id="session-search-results" className={styles.list} role="listbox">
        {hits.map((hit, index) => (
          <li
            key={hit.session.id}
            role="option"
            aria-selected={index === active}
            className={index === active ? styles.itemActive : styles.item}
            ref={(element) => {
              if (index === active) {
                element?.scrollIntoView({ block: 'nearest' })
              }
            }}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(hit)}
          >
            <div className={styles.title}>{hit.session.title || t('untitledChat')}</div>
            {hit.snippet ? (
              <div className={styles.snippet}>
                {hit.snippet.before}
                <mark className={styles.mark}>{hit.snippet.match}</mark>
                {hit.snippet.after}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {query.trim() && hits.length === 0 ? (
        <div className={styles.status} role="status">
          {searching ? t('sessionSearching') : t('sessionSearchEmpty')}
        </div>
      ) : searching ? (
        <div className={styles.status} role="status">
          {t('sessionSearching')}
        </div>
      ) : null}
    </Modal>
  )
}
