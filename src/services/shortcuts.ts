import type { TranslationKey } from '../i18n/index.js'

/** 快捷键里的按键记号；mod / shift / alt 是修饰键，mod 在 macOS 上是 ⌘，其他系统是 Ctrl，其余按字面显示 */
export type KeyToken = string

export type ShortcutGroup = 'general' | 'conversation' | 'input'

export type Shortcut = {
  id: string
  keys: KeyToken[]
  label: TranslationKey
  group: ShortcutGroup
}

/** 供「快捷键」弹窗展示；全局快捷键的实际处理在 useGlobalShortcuts */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'shortcuts', keys: ['mod', '/'], label: 'shortcutOpenShortcuts', group: 'general' },
  { id: 'newChat', keys: ['mod', 'shift', 'O'], label: 'shortcutNewChat', group: 'general' },
  { id: 'toggleSider', keys: ['mod', 'B'], label: 'shortcutToggleSider', group: 'general' },
  { id: 'search', keys: ['mod', 'K'], label: 'shortcutSearch', group: 'general' },
  { id: 'focusInput', keys: ['/'], label: 'shortcutFocusInput', group: 'general' },
  { id: 'stop', keys: ['Esc'], label: 'shortcutStop', group: 'conversation' },
  { id: 'prevTurn', keys: ['alt', '↑'], label: 'shortcutPrevTurn', group: 'conversation' },
  { id: 'nextTurn', keys: ['alt', '↓'], label: 'shortcutNextTurn', group: 'conversation' },
  { id: 'send', keys: ['Enter'], label: 'shortcutSend', group: 'input' },
  { id: 'newline', keys: ['shift', 'Enter'], label: 'shortcutNewline', group: 'input' },
  { id: 'slash', keys: ['/'], label: 'shortcutSlash', group: 'input' },
]

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

/** 把记号转成界面上显示的按键名 */
export const formatKey = (token: KeyToken): string => {
  const mac = isMac()
  switch (token) {
    case 'mod':
      return mac ? '⌘' : 'Ctrl'
    case 'shift':
      return mac ? '⇧' : 'Shift'
    case 'alt':
      return mac ? '⌥' : 'Alt'
    default:
      return token
  }
}

/** 当前事件是否带了「主修饰键」（macOS 的 ⌘，其他系统的 Ctrl） */
export const hasMod = (event: KeyboardEvent): boolean =>
  isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
