import { create } from 'zustand'

type ScrollState = {
  /** 阅读位置是否贴着底部（正在跟随最新内容） */
  atBottom: boolean
  /** 跳到最底部并恢复跟随，由消息列表挂载时登记 */
  jumpToBottom: () => void
  /** 跳到上一轮（-1）或下一轮（1）提问，由消息列表挂载时登记 */
  jumpTurn: (delta: 1 | -1) => void
}

const noop = () => {}

/** 消息列表把滚动状态与跳转动作放在这里，输入框区域的按钮与全局快捷键据此操作，不必层层传递。 */
export const useScrollState = create<ScrollState>(() => ({
  atBottom: true,
  jumpToBottom: noop,
  jumpTurn: noop,
}))

export const setScrollAtBottom = (atBottom: boolean) =>
  useScrollState.setState((state) => (state.atBottom === atBottom ? state : { atBottom }))
