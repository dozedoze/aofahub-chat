import type { AssistantMessage } from './types.js'

export type TurnUsageStats = {
  /** 本次请求的全部输入 Token（含缓存命中与写入缓存） */
  inputTokens: number
  outputTokens: number
  /** 输入中命中缓存的比例 0~1；没有输入时为 null */
  cacheHit: number | null
  /** 输出速度 Token/秒；无法可靠估算时为 null */
  speed: number | null
}

/** 太短的区间算出来的速度没有意义 */
const MIN_STREAM_MS = 300

/**
 * 汇总一条回答的用量。
 * 速度按「第一个内容块 → 结束」估算；一轮里穿插了工具调用时，这段时间包含工具执行与多次请求，
 * 算出来会偏低且不代表模型本身，所以直接不给。
 */
export const getTurnUsage = (message: AssistantMessage): TurnUsageStats | null => {
  const usage = message.usage
  if (!usage) {
    return null
  }
  const inputTokens =
    usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
  const outputTokens = usage.output_tokens
  if (inputTokens === 0 && outputTokens === 0) {
    return null
  }
  const hasTools = message.blocks.some(
    (block) => block.type !== 'text' && block.type !== 'thinking'
  )
  const duration =
    message.firstTokenAt !== undefined && message.endedAt !== undefined
      ? message.endedAt - message.firstTokenAt
      : 0
  return {
    inputTokens,
    outputTokens,
    cacheHit: inputTokens > 0 ? usage.cache_read_input_tokens / inputTokens : null,
    speed:
      !hasTools && outputTokens > 0 && duration >= MIN_STREAM_MS
        ? outputTokens / (duration / 1000)
        : null,
  }
}
