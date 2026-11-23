import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { fetchModels, type ThinkingMode } from './auth.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：语言、主题、位置、朗读音色、模型、深度思考与智能搜索开关、侧边栏收起状态。不存密码、不存 Key。 */
type Settings = {
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  model: string
  models: string[]
  /** 网关 /models 返回的上下文窗口（token），缺省时按模型名估算 */
  contextWindows: Record<string, number>
  /** 网关 /models 返回的深度思考能力；老网关没有这个字段，按可开关处理 */
  thinkingModes: Record<string, ThinkingMode>
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  model: 'chat-demo:model',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return 'zh-CN'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialModel = (): string => read(KEYS.model) || 'auto'

export const useSettings = create<Settings>(() => {
  try {
    localStorage.removeItem('chat-demo:api-key')
  } catch {
    // ignore
  }
  return {
    locale: initialLocale(),
    location: initialLocation(),
    themePreference: initialThemePreference(),
    ttsVoice: initialTtsVoice(),
    model: initialModel(),
    models: ['auto'],
    contextWindows: {},
    thinkingModes: {},
    thinking: read(KEYS.thinking) === 'true',
    search: read(KEYS.search) === 'true',
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  }
})

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setModel = (model: string) => {
  write(KEYS.model, model)
  useSettings.setState({ model })
}

export const refreshModels = async () => {
  const { ids: models, contextWindows, thinkingModes } = await fetchModels()
  const current = useSettings.getState().model
  const model = models.includes(current)
    ? current
    : models.includes('auto')
      ? 'auto'
      : (models[0] ?? 'auto')
  write(KEYS.model, model)
  useSettings.setState({ models, model, contextWindows, thinkingModes })
}

/** 这个模型的开关有没有意义：只有能控制思考的模型和 auto 才显示 */
export const canToggleThinking = (mode: ThinkingMode | undefined) =>
  mode === undefined || mode === 'toggle' || mode === 'effort' || mode === 'auto'

/** 发请求时的思考状态：永远在思考的按开启记，不是推理模型按关闭记，认不出的交给回复内容决定 */
export const effectiveThinking = (model: string): boolean | undefined => {
  const { thinking, thinkingModes } = useSettings.getState()
  const mode = thinkingModes[model]
  switch (mode) {
    case 'always':
      return true
    case 'none':
      return false
    case 'unknown':
      return undefined
    default:
      return thinking
  }
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
