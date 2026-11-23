import { getVisibleMessages } from './branches.js'
import type { Session } from './types.js'

const DEFAULT_CONTEXT_WINDOW = 200_000

/** 模型名里带 [1m] / -1m 后缀的按 100 万估算 */
const ONE_MILLION = /(\[1m\]|[-_]1m\b)/i

/**
 * 网关没有给出上下文窗口时，按模型名估算；估不出来就用 20 万。
 * 估算值只用于展示占用比例，不参与请求。
 */
export const estimateContextWindow = (model: string): number => {
  const id = model.toLowerCase()
  if (ONE_MILLION.test(id)) {
    return 1_000_000
  }
  if (id.includes('deepseek')) {
    return 128_000
  }
  if (id.includes('gemini')) {
    return 1_000_000
  }
  if (id.includes('gpt-4.1')) {
    return 1_000_000
  }
  if (id.includes('gpt-5')) {
    return 400_000
  }
  if (id.includes('gpt-4')) {
    return 128_000
  }
  if (id.includes('grok')) {
    return 256_000
  }
  if (id.includes('kimi') || id.includes('moonshot')) {
    return 256_000
  }
  if (id.includes('qwen') || id.includes('glm')) {
    return 128_000
  }
  return DEFAULT_CONTEXT_WINDOW
}

export const getContextWindow = (model: string, known: Record<string, number>): number =>
  known[model] ?? estimateContextWindow(model)

export type ContextUsage = {
  used: number
  limit: number
  /** 0–100，保留一位小数 */
  percent: number
  model: string
}

/**
 * 当前上下文占用：取当前分支上最近一次带用量的回复，
 * 输入（含缓存读写）加输出即下一轮请求会带上的历史规模。
 */
export const getContextUsage = (
  session: Session | undefined,
  selectedModel: string,
  known: Record<string, number>
): ContextUsage => {
  let used = 0
  let lastModel: string | null = null
  if (session) {
    const messages = getVisibleMessages(session)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'assistant') {
        continue
      }
      lastModel ??= message.model
      const { usage } = message
      if (usage) {
        used =
          usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          usage.output_tokens
        lastModel = message.model ?? lastModel
        break
      }
    }
  }
  // 选择“auto”时由网关路由，窗口以最近实际使用的模型为准。
  const model = selectedModel === 'auto' && lastModel ? lastModel : selectedModel
  const limit = getContextWindow(model, known)
  const percent = Math.min(100, Math.round((used / limit) * 1000) / 10)
  return { used, limit, percent, model }
}
