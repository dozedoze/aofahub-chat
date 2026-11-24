import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { ToolStep } from '../../services/chat/view.js'
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

const ToolIcon = ({ name }: { name: string }) =>
  name === 'web_search' ? (
    <IconSearchOutline16 />
  ) : name === 'fetch_url' ? (
    <IconBrowseOutline16 />
  ) : (
    <IconToolOutline16 />
  )

/**
 * 网关代为执行的工具调用：一行说明「调用了什么、传了什么、成没成功、花了多久」，
 * 点开能看到完整入参与返回摘要。用户自己的 MCP、Skill 与联网工具都走这里。
 */
export const ToolCallRow = memo(function ToolCallRow({
  step,
  interrupted,
  isLast,
}: {
  step: ToolStep
  /** 回复被用户停止时，没有拿到结果的调用显示为已中止，而不是失败 */
  interrupted: boolean
  isLast: boolean
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const wip = step.status === 'wip'
  const failed = step.status === 'failed'
  const nameKey = KNOWN_NAMES[step.name]
  const label = nameKey ? t(nameKey) : step.label
  const verb = wip
    ? t('toolCallRunningShort')
    : failed
      ? t(interrupted && step.result === null ? 'toolCallStopped' : 'toolCallFailed')
      : t('toolCallDone')
  const hasInput = Object.keys(step.input).length > 0
  const detailId = `tool-detail-${step.id}`
  return (
    <div className={clsx(replyStyles.tool, !isLast && replyStyles.withLine)}>
      <span className={clsx(replyStyles.rowIcon, replyStyles.toolIcon)}>
        {failed && !interrupted ? <IconWarningOutline16 /> : <ToolIcon name={step.name} />}
      </span>
      <div className={styles.body}>
        <button
          type="button"
          className={styles.head}
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={clsx(styles.verb, wip && replyStyles.shimmer, failed && styles.failed)}>
            {verb}
          </span>
          <span className={styles.label}>{label}</span>
          {step.server ? <span className={styles.server}>{step.server}</span> : null}
          {step.summary ? <span className={styles.summary}>{step.summary}</span> : null}
          {step.ms !== null ? <span className={styles.ms}>{formatDuration(step.ms)}</span> : null}
          <span className={styles.chevron}>
            {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          </span>
        </button>
        {open ? (
          <div id={detailId} className={styles.detail}>
            {hasInput ? (
              <>
                <div className={styles.detailTitle}>{t('toolCallInput')}</div>
                <pre className={styles.pre}>{clip(JSON.stringify(step.input, null, 2))}</pre>
              </>
            ) : null}
            <div className={styles.detailTitle}>{t('toolCallResult')}</div>
            <pre className={clsx(styles.pre, failed && styles.preFailed)}>
              {step.result === null
                ? t(wip ? 'toolCallPending' : 'toolCallNoResult')
                : step.result
                  ? clip(step.result)
                  : t('toolCallNoResult')}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  )
})
