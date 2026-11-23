import { getVisibleMessages } from './branches.js'
import type { Session } from './types.js'

/** 当前分支最近一次回复的思考状态：优先看请求时记录的开关，没有记录时看内容里有没有思考块。 */
export const getLatestReplyThinking = (session: Session | undefined): boolean | undefined => {
  if (!session) {
    return undefined
  }
  const path = getVisibleMessages(session)
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const message = path[index]
    if (message?.role === 'assistant') {
      return (
        message.thinking ?? (message.blocks.some((block) => block.type === 'thinking') || undefined)
      )
    }
  }
  return undefined
}
