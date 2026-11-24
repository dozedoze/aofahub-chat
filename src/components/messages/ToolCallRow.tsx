import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { getSiteName, type ToolStep } from '../../services/chat/view.js'
import {
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconSearchOutline16,
  IconToolOutline16,
  IconWarningOutline16,
} from '../base/icons.js'
import replyStyles from './ReplyArea.module.css'
import styles from './ToolCallRow.module.css'

const KNOWN_NAMES: Record<string, TranslationKey> = {
  web_search: 'toolNameWebSearch',
  fetch_url: 'toolNameFetchUrl',
  load_skill: 'toolNameLoadSkill',
}

/** 入参、结果展示的字数上限，避免撑开消息 */
const DETAIL_MAX = 4000

const clip = (text: string) => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text)

const formatDuration = (ms: number) =>
  ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`

/** 结果每行都是网址（如搜索结果）时按链接列表展示，否则返回 null 走原文。 */
const parseUrlLines = (text: string): string[] | null => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.length > 0 &&
    lines.length <= 50 &&
    lines.every((line) => /^https?:\/\/\S+$/.test(line))
    ? lines
    : null
}

const ToolIcon = ({ name }: { name: string }) =>
  name === 'web_search' ? (
    <IconSearchOutline16 />
  ) : name === 'fetch_url' ? (
    <IconBrowseOutline16 />
  ) : (
    <IconToolOutline16 />
  )

const Chevron = ({ open }: { open: boolean }) => (
  <span className={styles.chevron}>
    {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
  </span>
)

/** 单次调用的返回内容：搜索结果显示为链接列表，其余显示原文。 */
const CallResult = ({ step, interrupted }: { step: ToolStep; interrupted: boolean }) => {
  const t = useTranslate()
  const wip = step.status === 'wip'
  const failed = step.status === 'failed'
  // 入参已浓缩成摘要；只有摘要说明不了调用内容时才补上完整入参。
  const showInput = !step.summary && Object.keys(step.input).length > 0
  const urls = step.result ? parseUrlLines(step.result) : null
  return (
    <div className={styles.detail}>
      {showInput ? (
        <>
          <div className={styles.detailTitle}>{t('toolCallInput')}</div>
          <pre className={styles.pre}>{clip(JSON.stringify(step.input, null, 2))}</pre>
        </>
      ) : null}
      {urls ? (
        <ul className={styles.links}>
          {urls.map((url) => (
            <li key={url} className={styles.linkItem}>
              <span className={styles.host}>{getSiteName(url)}</span>
              <a href={url} target="_blank" rel="noreferrer" className={styles.link}>
                {url}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <pre className={clsx(styles.pre, failed && styles.preFailed)}>
          {step.result === null
            ? t(wip ? 'toolCallPending' : interrupted ? 'toolCallStopped' : 'toolCallNoResult')
            : step.result
              ? clip(step.result)
              : t('toolCallNoResult')}
        </pre>
      )}
    </div>
  )
}

/** 组内的一次调用：一行摘要 + 耗时，点开看返回内容。 */
const CallItem = ({ step, interrupted }: { step: ToolStep; interrupted: boolean }) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const wip = step.status === 'wip'
  const failed = step.status === 'failed'
  return (
    <div className={styles.item}>
      <button
        type="button"
        className={styles.itemHead}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={clsx(styles.itemText, wip && replyStyles.shimmer, failed && styles.failed)}
        >
          {step.summary || (failed && !interrupted ? t('toolCallFailed') : '—')}
        </span>
        {step.ms !== null ? <span className={styles.ms}>{formatDuration(step.ms)}</span> : null}
        <Chevron open={open} />
      </button>
      {open ? <CallResult step={step} interrupted={interrupted} /> : null}
    </div>
  )
}

/**
 * 网关代为执行的工具调用，相邻的同名调用合并为一组：
 * 收起时只有一行「已调用 搜索网页 ×4」，展开后逐次列出摘要与耗时，再点开看返回内容。
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  steps,
  interrupted,
}: {
  steps: ToolStep[]
  /** 回复被用户停止时，没有拿到结果的调用显示为已中止，而不是失败 */
  interrupted: boolean
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const first = steps[0]
  const multi = steps.length > 1
  const running = steps.filter((step) => step.status === 'wip')
  const wip = running.length > 0
  const failedCount = steps.filter((step) => step.status === 'failed').length
  const allFailed = !wip && failedCount === steps.length
  const nameKey = KNOWN_NAMES[first.name]
  const label = nameKey ? t(nameKey) : first.label
  const verb = wip
    ? t('toolCallRunningShort')
    : allFailed
      ? t(
          interrupted && steps.every((step) => step.result === null)
            ? 'toolCallStopped'
            : 'toolCallFailed'
        )
      : t('toolCallDone')
  // 进行中的一组显示正在跑的那次调用的摘要，让人看出在搜什么。
  const summary = multi ? (running.at(-1)?.summary ?? '') : first.summary
  const totalMs = steps.every((step) => step.ms !== null)
    ? steps.reduce((sum, step) => sum + (step.ms ?? 0), 0)
    : null
  const showMs = totalMs !== null && !wip
  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={clsx(styles.icon, allFailed && !interrupted && styles.failed)}>
          {allFailed && !interrupted ? <IconWarningOutline16 /> : <ToolIcon name={first.name} />}
        </span>
        <span className={clsx(styles.verb, wip && replyStyles.shimmer, allFailed && styles.failed)}>
          {verb}
        </span>
        <span className={styles.label}>{label}</span>
        {multi ? <span className={styles.count}>×{steps.length}</span> : null}
        {first.server ? <span className={styles.server}>{first.server}</span> : null}
        {summary ? (
          <span className={styles.summary}>{summary}</span>
        ) : (
          <span className={styles.fill} />
        )}
        {multi && failedCount > 0 && !allFailed ? (
          <span className={styles.failed}>{t('toolCallFailedCount', { count: failedCount })}</span>
        ) : null}
        {showMs ? <span className={styles.ms}>{formatDuration(totalMs)}</span> : null}
        <Chevron open={open} />
      </button>
      {open ? (
        multi ? (
          <div className={styles.items}>
            {steps.map((step) => (
              <CallItem key={step.id} step={step} interrupted={interrupted} />
            ))}
          </div>
        ) : (
          <CallResult step={first} interrupted={interrupted} />
        )
      ) : null}
    </div>
  )
})
