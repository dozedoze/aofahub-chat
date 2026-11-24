import { create } from 'zustand'

/** 快捷键弹窗与会话搜索弹窗的开关，由快捷键、侧边栏按钮与斜杠命令打开 */
export const useOverlays = create(() => ({ shortcuts: false, search: false }))

export const openShortcuts = () => useOverlays.setState({ shortcuts: true })
export const closeShortcuts = () => useOverlays.setState({ shortcuts: false })
export const openSessionSearch = () => useOverlays.setState({ search: true })
export const closeSessionSearch = () => useOverlays.setState({ search: false })
