/**
 * 识别用户消息里的凭据（API Key、令牌、私钥、带密码的连接串），只用于「显示时遮住」。
 * 消息原文、复制与发给模型的内容都保持原样，这里只算出哪一段该被遮住、遮完长什么样。
 */

export type SecretRun = {
  start: number
  end: number
  /** 遮住后的显示文本，长度与原文一致，便于切换显示时不改变排版 */
  masked: string
}

/** 令牌类保留的开头字符数，方便用户认出是哪一个 */
const KEEP = 8

const PREFIXED: RegExp[] = [
  // 模型服务商 Key：至少含一个数字，避免误伤 sk-learn 这类普通单词
  /\bsk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bLTAI[A-Za-z0-9]{12,}/g,
  /\bAKID[A-Za-z0-9]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bwhsec_[A-Za-z0-9]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
]

const PRIVATE_KEY = /-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g
const URL_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]+)@/gi

const stars = (count: number) => '*'.repeat(Math.max(0, count))

const maskToken = (value: string) => value.slice(0, KEEP) + stars(value.length - KEEP)

/** 私钥块保留 BEGIN、END 两行和换行，只遮住中间的内容 */
const maskPrivateKey = (value: string) =>
  value
    .split('\n')
    .map((line, index, lines) =>
      index === 0 || index === lines.length - 1 || line === '' ? line : stars(line.length)
    )
    .join('\n')

/** 找出文本里所有需要遮住的段落，按位置排序且互不重叠 */
export const findSecrets = (text: string): SecretRun[] => {
  // 绝大多数消息没有任何凭据特征，先用廉价的子串判断挡掉，免得每条消息跑十几个正则。
  if (
    !/(sk-|AIza|gh[pousr]_|github_pat_|glpat-|npm_|hf_|AKIA|ASIA|LTAI|AKID|xox|sk_|rk_|whsec_|eyJ|PRIVATE KEY|:\/\/)/.test(
      text
    )
  ) {
    return []
  }
  const runs: SecretRun[] = []
  for (const pattern of PREFIXED) {
    for (const match of text.matchAll(pattern)) {
      runs.push({
        start: match.index,
        end: match.index + match[0].length,
        masked: maskToken(match[0]),
      })
    }
  }
  for (const match of text.matchAll(PRIVATE_KEY)) {
    runs.push({
      start: match.index,
      end: match.index + match[0].length,
      masked: maskPrivateKey(match[0]),
    })
  }
  for (const match of text.matchAll(URL_PASSWORD)) {
    const password = match[1]
    const start = match.index + match[0].length - 1 - password.length
    runs.push({ start, end: start + password.length, masked: stars(password.length) })
  }
  // 重叠时位置靠前的优先，位置相同取更长的。
  runs.sort((a, b) => a.start - b.start || b.end - a.end)
  const result: SecretRun[] = []
  for (const run of runs) {
    const last = result.at(-1)
    if (!last || run.start >= last.end) {
      result.push(run)
    }
  }
  return result
}
