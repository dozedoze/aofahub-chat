import { expireSession } from '../auth.js'
import { translate, type TranslationMessage } from '../../i18n/index.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type { ApiErrorBody, CreateMessageRequest, MessageStreamEvent } from './types.js'

/** 构建期 API 地址，见 rspack.config.ts */
export const API_ORIGIN = __API_ORIGIN__
/** 聊天走托管 skill；默认 /anthropic/v1/messages 不注入通用 skill */
const SKILL_MESSAGES_URL = `${API_ORIGIN}/anthropic/v1/skill/messages`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, { ...init, credentials: 'include' })
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (response.status === 401) {
    expireSession()
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (beta: boolean): Record<string, string> => ({
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

const hasFileId = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some(
        (block) =>
          (block.type === 'image' || block.type === 'document') && block.source.type === 'file'
      )
  )

/**
 * POST /anthropic/v1/skill/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  body: CreateMessageRequest,
  signal: AbortSignal,
  sessionId?: string
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(SKILL_MESSAGES_URL, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(hasFileId(body)),
      ...(sessionId ? { 'x-session-id': sessionId } : {}), // 粘性会话：钉上游账号并隔离窗口
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  try {
    for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        if (eventName !== 'error') {
          continue
        }
      }
      if (isErrorBody(payload)) {
        // 网关在上游中途断流时发 overloaded_error：和连接被掐断同样处理，可自动重试，文案用本地化的。
        if (payload.error.type === 'overloaded_error') {
          throw new ApiError('interrupted', '')
        }
        throw new ApiError('stream', payload.error.message)
      }
      if (eventName === 'error') {
        throw new ApiError('stream', data)
      }
      const event = readMessageEvent(payload)
      if (!event) {
        continue
      }
      yield event
      if (event.type === 'message_stop') {
        return
      }
    }
  } catch (error) {
    // 读取响应体时连接被掐断（浏览器抛 TypeError: network error 等）：归为中断，
    // 否则会被当成协议错误，用户只看到一句英文的 "network error"。
    if (signal.aborted || error instanceof ApiError) {
      throw error
    }
    throw new ApiError('interrupted', '')
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
