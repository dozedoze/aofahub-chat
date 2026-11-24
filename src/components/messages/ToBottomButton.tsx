import { useTranslate } from '../../i18n/index.js'
import { IconArrowDownOutline16 } from '../base/icons.js'
import { useScrollState } from './scrollState.js'
import styles from './ToBottomButton.module.css'

/** 离开底部时出现的「回到底部」按钮，放在输入框容器里，浮在输入框正上方。 */
export const ToBottomButton = () => {
  const t = useTranslate()
  const atBottom = useScrollState((state) => state.atBottom)
  const jump = useScrollState((state) => state.jumpToBottom)
  if (atBottom) {
    return null
  }
  return (
    <button type="button" className={styles.button} aria-label={t('backToBottom')} onClick={jump}>
      <IconArrowDownOutline16 />
    </button>
  )
}
