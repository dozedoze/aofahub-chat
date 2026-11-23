import { streamMessage } from '../api/client.js'
import type { ChatModel } from '../api/types.js'

/**
 * 只有 deepseek 的接口会在流里顺带返回标题；其它模型（如 auto 路由到的 grok）没有这个能力，
 * 回答结束后由客户端再发一次很短的请求，让模型把这一轮对话概括成标题。
 */
const TITLE_SYSTEM =
  'You write short titles for chat conversations. Reply with the title only: no quotes, ' +
  'no trailing punctuation, no prefix, at most 12 Chinese characters or 6 English words. ' +
  "Use the same language as the user's message."

const MAX_TITLE_CHARS = 30
const MAX_CONTEXT_CHARS = 600

const clip = (text: string, max: number) => Array.from(text).slice(0, max).join('')

/** 模型输出清理成单行标题：去引号、书名号、"标题："前缀与句末标点 */
export const cleanTitle = (raw: string): string => {
  const line = raw.split('\n').find((part) => part.trim()) ?? ''
  const title = line
    .replace(/^\s*(title|标题)\s*[:：]\s*/i, '')
    .replace(/^["'“”‘’「」『』《》#*\s]+|["'“”‘’「」『』《》*\s]+$/g, '')
    .replace(/[。.!！?？,，;；:：]+$/, '')
    .trim()
  return clip(title, MAX_TITLE_CHARS)
}

/** 模型不可用时的兜底：取提问首行，没有文字就用第一个附件名 */
export const fallbackTitle = (question: string, fileNames: string[]): string => {
  const line = question.split('\n').find((part) => part.trim()) ?? fileNames[0] ?? ''
  const text = line.trim()
  const clipped = clip(text, 20)
  return clipped.length < Array.from(text).length ? `${clipped}…` : clipped
}

/** 请模型概括标题；失败、被中止或结果为空时返回 null */
export const generateTitle = async (
  model: ChatModel,
  question: string,
  answer: string,
  signal: AbortSignal
): Promise<string | null> => {
  const prompt =
    `User message:\n${clip(question, MAX_CONTEXT_CHARS)}\n\n` +
    `Assistant reply:\n${clip(answer, MAX_CONTEXT_CHARS)}\n\n` +
    'Write the title for this conversation.'
  let text = ''
  try {
    for await (const event of streamMessage(
      {
        model,
        system: TITLE_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        thinking: { type: 'disabled' },
      },
      signal
    )) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
        // 标题很短，多出来的说明模型没按要求回答，直接截断使用
        if (text.length > MAX_TITLE_CHARS * 4) {
          break
        }
      }
    }
  } catch {
    return null
  }
  return cleanTitle(text) || null
}
