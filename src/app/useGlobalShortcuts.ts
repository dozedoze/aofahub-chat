import { useEffect } from 'react'
import {
  closeMobileSider,
  openMobileSider,
  useMobileSider,
} from '../components/sider/mobileSiderState.js'
import { useScrollState } from '../components/messages/scrollState.js'
import { openSessionSearch, openShortcuts } from '../components/shortcuts/shortcutsState.js'
import { newChat, stopReply, useChatStore } from '../services/chat/store.js'
import { hasMod } from '../services/shortcuts.js'
import { setSiderCollapsed, useSettings } from '../services/settings.js'
import { stopReadAloud } from '../services/speech/readAloud.js'

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/** 有弹窗、菜单或下拉打开时，全局快捷键让位给它们自己的键盘处理 */
const overlayOpen = () =>
  document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null

const focusInput = () => {
  const input = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]')
  input?.focus()
  return input !== null
}

/**
 * 全局快捷键：⌘/Ctrl+/ 快捷键列表、⌘/Ctrl+Shift+O 新对话、⌘/Ctrl+B 侧边栏、⌘/Ctrl+K 搜索会话、
 * Esc 停止生成、/ 聚焦输入框、Alt+↑/↓ 在提问之间跳转。
 */
export const useGlobalShortcuts = (isMobile: boolean) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) {
        return
      }
      const key = event.key
      const lower = key.toLowerCase()

      if (hasMod(event) && !event.altKey) {
        if (key === '/' && !event.shiftKey) {
          event.preventDefault()
          openShortcuts()
        } else if (lower === 'o' && event.shiftKey) {
          event.preventDefault()
          if (!overlayOpen()) {
            newChat()
            closeMobileSider()
            requestAnimationFrame(focusInput)
          }
        } else if (lower === 'b' && !event.shiftKey) {
          event.preventDefault()
          if (isMobile) {
            if (useMobileSider.getState().open) {
              closeMobileSider()
            } else {
              openMobileSider()
            }
          } else {
            setSiderCollapsed(!useSettings.getState().siderCollapsed)
          }
        } else if (lower === 'k' && !event.shiftKey) {
          event.preventDefault()
          openSessionSearch()
        }
        return
      }

      if (
        event.altKey &&
        !hasMod(event) &&
        !event.shiftKey &&
        (key === 'ArrowUp' || key === 'ArrowDown')
      ) {
        if (!overlayOpen()) {
          event.preventDefault()
          useScrollState.getState().jumpTurn(key === 'ArrowDown' ? 1 : -1)
        }
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (key === 'Escape') {
        const { activeId, streaming } = useChatStore.getState()
        if (activeId !== null && Object.hasOwn(streaming, activeId) && !overlayOpen()) {
          // 正在编辑历史提问时 Esc 属于编辑框（取消编辑），不停止生成
          if (
            event.target instanceof HTMLTextAreaElement &&
            !event.target.hasAttribute('data-chat-input')
          ) {
            return
          }
          stopReadAloud()
          stopReply(activeId)
        }
        return
      }

      if (key === '/' && !isEditable(event.target) && !overlayOpen()) {
        if (focusInput()) {
          event.preventDefault()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isMobile])
}
