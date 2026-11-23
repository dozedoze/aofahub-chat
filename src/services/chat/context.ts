import { getVisibleMessages } from './branches.js'
import { getContextRounds, getReplyText } from './reply.js'
import { SYSTEM_PROMPT } from './systemPrompt.js'
import type { AssistantMessage, FileAttachment, Session, UserMessage } from './types.js'

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

// ---------- 本地分项估算 ----------

/** 中日韩字符按 1 token，其余按 4 个字符 1 token。只用来拆分占比，总量以服务端回报为准。 */
export const estimateTokens = (text: string): number => {
  let wide = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      wide += 1
    }
  }
  return Math.ceil(wide + (text.length - wide) / 4)
}

/** 图片按固定值估算（尺寸已在上传前限制）；文本类附件按字节数估算，与读取上限一致。 */
const IMAGE_TOKENS = 1_500
const MAX_FILE_TOKENS = 100_000

type FileLike = Pick<FileAttachment, 'isImage' | 'size'>

const fileTokens = ({ isImage, size }: FileLike) =>
  isImage ? IMAGE_TOKENS : Math.min(Math.ceil(size / 3), MAX_FILE_TOKENS)

/**
 * 上下文分项。
 * server：服务端附加的部分（系统提示、Skill、MCP 与工具定义），本地看不到，由回报总量减去本地分项得到；
 * system：本应用自己发送的系统提示与最新信息；
 * thinking：最近一次回复的思考，计入回报的输出量，下一轮请求不会回传。
 */
export type ContextSegmentKey =
  | 'server'
  | 'system'
  | 'user'
  | 'attachments'
  | 'assistant'
  | 'web'
  | 'thinking'
  | 'draft'

export type ContextSegment = { key: ContextSegmentKey; tokens: number }

type Parts = Partial<Record<ContextSegmentKey, number>>

const userParts = new WeakMap<UserMessage, Parts>()
const assistantParts = new WeakMap<AssistantMessage, Parts>()

const getUserParts = (message: UserMessage): Parts => {
  let parts = userParts.get(message)
  if (!parts) {
    parts = {
      user: estimateTokens(message.content),
      attachments: message.files.reduce((sum, file) => sum + fileTokens(file), 0),
    }
    userParts.set(message, parts)
  }
  return parts
}

/** 阅读链接的页面加密在结果块里，下一轮请求会回传，长度近似页面正文。 */
const getAssistantParts = (message: AssistantMessage): Parts => {
  let parts = assistantParts.get(message)
  if (!parts) {
    let thinking = 0
    let web = 0
    for (const block of message.blocks) {
      if (block.type === 'thinking') {
        thinking += estimateTokens(block.thinking)
      } else if (block.type === 'web_fetch_tool_result' && block.kind === 'read_link') {
        web += Math.ceil((block.signature?.length ?? 0) / 4)
      }
    }
    parts = { assistant: estimateTokens(getReplyText(message)), web, thinking }
    assistantParts.set(message, parts)
  }
  return parts
}

const add = (target: Parts, source: Parts, skip?: ContextSegmentKey) => {
  for (const [key, value] of Object.entries(source) as [ContextSegmentKey, number][]) {
    if (key !== skip) {
      target[key] = (target[key] ?? 0) + value
    }
  }
}

const SEGMENT_ORDER: ContextSegmentKey[] = [
  'server',
  'system',
  'user',
  'attachments',
  'assistant',
  'web',
  'thinking',
  'draft',
]

export type ContextDraft = { text: string; files: FileLike[] }

export type ContextUsage = {
  used: number
  limit: number
  /** 0–100，保留一位小数 */
  percent: number
  model: string
  /** 没有服务端回报的用量时，全部为本地估算 */
  estimated: boolean
  /** 窗口大小是否来自网关；否则按模型名猜测 */
  windowKnown: boolean
  segments: ContextSegment[]
}

type ReportedUsage = NonNullable<AssistantMessage['usage']>

const inputTokens = (usage: ReportedUsage) =>
  usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)

/** 输入量为 0 说明上游没给用量（只剩一个输出数），不能当作回报，否则会把整段上下文算成几十个 token。 */
const hasReportedUsage = (message: AssistantMessage) =>
  message.usage !== undefined && inputTokens(message.usage) > 0

/**
 * 当前上下文占用：取当前分支上最近一次带用量的回复，输入（含缓存读写）加输出即下一轮请求会带上的历史规模；
 * 没有回报时（新会话、导入的历史）按内容估算。分项由本地内容估算，并校准到回报总量：
 * 估算小于回报的差额记为服务端附加，大于回报则等比缩小。输入框里还没发送的内容另算在总量之上。
 * 所有数据都来自本机已保存的消息，不依赖服务端存储。
 */
export const getContextUsage = (
  session: Session | undefined,
  selectedModel: string,
  known: Record<string, number>,
  draft?: ContextDraft
): ContextUsage => {
  const visible = session ? getVisibleMessages(session) : []
  let usageIndex = -1
  let lastModel: string | null = null
  let reminder = ''
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const message = visible[index]
    if (message.role !== 'assistant') {
      continue
    }
    lastModel ??= message.model
    reminder ||= message.latestReminder ?? ''
    if (hasReportedUsage(message) && usageIndex < 0) {
      usageIndex = index
      lastModel = message.model ?? lastModel
    }
  }

  const usageReply = usageIndex >= 0 ? (visible[usageIndex] as AssistantMessage) : null
  const usage = usageReply?.usage
  const reported = usage ? inputTokens(usage) + usage.output_tokens : null

  // 回报覆盖到 usageReply 为止；之后的轮次（如回复失败没有用量）不在回报里。
  const covered = usageReply ? visible.slice(0, usageIndex + 1) : visible
  const rounds = getContextRounds(covered)
  const previous = visible[usageIndex - 1]
  if (usageReply && previous?.role === 'user' && !rounds.some(([, reply]) => reply === usageReply)) {
    // 正在生成或没有正文的回复：本轮提问和回复同样计入回报。
    rounds.push([previous, usageReply])
  }
  const local: Parts = { system: estimateTokens(SYSTEM_PROMPT) + estimateTokens(reminder) }
  for (const [user, reply] of rounds) {
    add(local, getUserParts(user))
    add(local, getAssistantParts(reply), reply === usageReply ? undefined : 'thinking')
  }
  const localTotal = Object.values(local).reduce((sum, value) => sum + value, 0)

  const parts: Parts = {}
  let base: number
  if (reported === null) {
    add(parts, local)
    base = localTotal
  } else {
    base = reported
    const scale = localTotal > reported ? reported / localTotal : 1
    for (const [key, value] of Object.entries(local) as [ContextSegmentKey, number][]) {
      parts[key] = Math.round(value * scale)
    }
    parts.server = Math.max(0, reported - Object.values(parts).reduce((sum, value) => sum + value, 0))
    // 回报之后又产生的、可进入上下文的轮次，按估算累加。
    for (const [user, reply] of getContextRounds(visible.slice(usageIndex + 1))) {
      const extra: Parts = {}
      add(extra, getUserParts(user))
      add(extra, getAssistantParts(reply), 'thinking')
      add(parts, extra)
      base += Object.values(extra).reduce((sum, value) => sum + value, 0)
    }
  }

  const pending = draft
    ? estimateTokens(draft.text) + draft.files.reduce((sum, file) => sum + fileTokens(file), 0)
    : 0
  if (pending > 0) {
    parts.draft = pending
  }

  // 选择“auto”时由网关路由，窗口以最近实际使用的模型为准。
  const model = selectedModel === 'auto' && lastModel ? lastModel : selectedModel
  const limit = getContextWindow(model, known)
  const used = base + pending
  const percent = Math.min(100, Math.round((used / limit) * 1000) / 10)
  const segments = SEGMENT_ORDER.flatMap((key) =>
    (parts[key] ?? 0) > 0 ? [{ key, tokens: parts[key] as number }] : []
  )
  return {
    used,
    limit,
    percent,
    model,
    estimated: reported === null,
    windowKnown: known[model] !== undefined,
    segments,
  }
}

export const isSameContextUsage = (a: ContextUsage, b: ContextUsage): boolean =>
  a.used === b.used &&
  a.limit === b.limit &&
  a.percent === b.percent &&
  a.model === b.model &&
  a.estimated === b.estimated &&
  a.windowKnown === b.windowKnown &&
  a.segments.length === b.segments.length &&
  a.segments.every(
    (segment, index) =>
      segment.key === b.segments[index].key && segment.tokens === b.segments[index].tokens
  )
