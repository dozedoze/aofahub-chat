import { useMemo, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { formatKey, SHORTCUTS, type ShortcutGroup } from '../../services/shortcuts.js'
import { Modal } from '../base/Modal.js'
import { closeShortcuts, useOverlays } from './shortcutsState.js'
import styles from './ShortcutsDialog.module.css'

const GROUPS: { value: ShortcutGroup; label: TranslationKey }[] = [
  { value: 'general', label: 'shortcutGroupGeneral' },
  { value: 'conversation', label: 'shortcutGroupConversation' },
  { value: 'input', label: 'shortcutGroupInput' },
]

export const ShortcutsDialog = () => {
  const open = useOverlays((state) => state.shortcuts)
  return open ? <Content /> : null
}

const Content = () => {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return GROUPS.map((group) => ({
      ...group,
      items: SHORTCUTS.filter(
        (item) =>
          item.group === group.value &&
          (!keyword ||
            t(item.label).toLowerCase().includes(keyword) ||
            item.keys.some((key) => formatKey(key).toLowerCase().includes(keyword)))
      ),
    })).filter((group) => group.items.length > 0)
  }, [query, t])

  return (
    <Modal title={t('shortcutsTitle')} closable className={styles.dialog} onClose={closeShortcuts}>
      <input
        className={styles.search}
        type="search"
        autoFocus
        value={query}
        placeholder={t('shortcutsSearchPlaceholder')}
        aria-label={t('shortcutsSearchPlaceholder')}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={styles.body}>
        {groups.length === 0 ? <div className={styles.empty}>{t('shortcutsEmpty')}</div> : null}
        {groups.map((group) => (
          <section key={group.value} className={styles.group}>
            <h3 className={styles.groupTitle}>{t(group.label)}</h3>
            {group.items.map((item) => (
              <div key={item.id} className={styles.row}>
                <span>{t(item.label)}</span>
                <span className={styles.keys}>
                  {item.keys.map((key) => (
                    <kbd key={key} className={styles.key}>
                      {formatKey(key)}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  )
}
