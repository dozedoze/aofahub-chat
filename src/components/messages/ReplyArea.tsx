import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useEffect, useState, type ReactNode } from 'react'
import {
  IconBrowseOutline16,
  IconBrowseWarningOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCheckedOutline14,
  IconCloseFill14,
  IconLinkOutline16,
  IconRightUpOutline14,
  IconSearchOutline16,
  IconSearchWarningOutline16,
  IconThinkOutline16,
} from '../base/icons.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import {
  getAreaTitle,
  isDeepSearchKind,
  isImageSearchKind,
  type FindStep,
  type OpenStep,
  type PageItem,
  type ReadLinkStep,
  type ReplyView,
  type SearchStep,
  type Source,
  type Step,
  type ThinkingStep,
  type ToolStep,
} from '../../services/chat/view.js'
import { Tooltip } from '../base/Tooltip.js'
import { Markdown } from '../markdown/Markdown.js'
import { ToolCallGroup } from './ToolCallRow.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import styles from './ReplyArea.module.css'
import './thinking.markdown.css'

/** 进行中时每秒刷新，用于思考用时与搜索词轮播 */
const useTicker = (active: boolean, interval: number) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => setTick((value) => value + 1), interval)
    return () => clearInterval(timer)
  }, [active, interval])
  return tick
}

/**
 * 思考与工具步骤的时间线：
 * 开启深度思考时带可折叠的标题（正在思考 / 正在搜索 / 正在浏览网页 / 已思考（用时 N 秒））；
 * 未开启时只有工具步骤（如普通搜索的「已阅读 N 个网页」）。
 */
export const ReplyArea = memo(function ReplyArea({
  message,
  view,
  streaming,
  hasResponse,
}: {
  message: AssistantMessage
  view: ReplyView
  streaming: boolean
  hasResponse: boolean
}) {
  const t = useTranslate()
  const thinkingView = useSettings((state) => state.thinkingView)
  // 用户手动点过标题后以手动为准；否则按设置：展开 / 回答开始后自动收起 / 收起
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open =
    manualOpen ?? (thinkingView === 'expanded' || (thinkingView === 'auto' && !hasResponse))
  const titleActive = streaming && !hasResponse
  useTicker(titleActive, 1000)
  if (view.steps.length === 0 && !(message.thinking && streaming)) {
    return null
  }
  // 未记录请求开关时，按是否有思考内容显示标题。
  const thinking = message.thinking ?? view.steps.some((step) => step.type === 'thinking')
  const now = Date.now()
  const toolCount = view.steps.filter((step) => step.type === 'tool').length
  const baseTitle = thinking ? getAreaTitle(view, streaming, now, hasResponse) : null
  // 没开深度思考时，网关工具调用也要有标题，说明正在做什么；结束后给出调用次数。
  const title =
    baseTitle ??
    (toolCount === 0
      ? null
      : titleActive || (streaming && !hasResponse)
        ? getAreaTitle(view, streaming, now, hasResponse)
        : t('toolCallsSummary', { count: toolCount }))
  // 进行中计时按发出请求起的总耗时算：工具执行、等待下一轮响应期间也要继续走，不能只累计思考块。
  const runningSeconds = titleActive
    ? Math.max(0, Math.floor((now - message.createdAt) / 1000))
    : null
  const stopped = !streaming && !hasResponse
  const items = groupSteps(view.steps)
  return (
    <div className={styles.area}>
      {title ? (
        <div className={styles.title} onClick={() => setManualOpen(!open)}>
          <span className={clsx(styles.titleIcon, stopped && styles.stoppedIcon)}>
            <IconThinkOutline16 />
          </span>
          <span className={clsx(styles.titleText, titleActive && styles.shimmer)}>{title}</span>
          {runningSeconds !== null ? (
            <span className={styles.timer}>
              {t('messageElapsedSeconds', { count: runningSeconds })}
            </span>
          ) : null}
          {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </div>
      ) : null}
      {open || !title ? (
        <div className={styles.steps}>
          {items.map((item, index) =>
            item.type === 'tools' ? (
              <ToolCallGroup
                key={`tools-${(item.entries[0] as ToolStep).id}`}
                entries={item.entries}
                interrupted={!streaming && message.status === 'stopped'}
                renderThinking={(step) => (
                  <StepItem
                    step={step}
                    message={message}
                    sources={view.sources}
                    streaming={streaming}
                    isLast={false}
                  />
                )}
              />
            ) : (
              <StepItem
                key={stepKey(item, index)}
                step={item}
                message={message}
                sources={view.sources}
                streaming={streaming}
                isLast={index === items.length - 1}
              />
            )
          )}
        </div>
      ) : null}
    </div>
  )
})

type RenderItem =
  | Exclude<Step, ToolStep>
  | { type: 'tools'; entries: (ToolStep | ThinkingStep)[] }

/**
 * 同名工具调用合并成一组，避免模型边想边搜时刷出一长串。
 * 调用之间夹着的思考文字收进同一组里，展开后按顺序还是「想 → 搜 → 想 → 搜」，收起时只有一行总览。
 */
const groupSteps = (steps: Step[]): RenderItem[] => {
  const items: RenderItem[] = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (step.type !== 'tool') {
      items.push(step)
      continue
    }
    const last = items.at(-1)
    if (last?.type === 'tools' && toolName(last.entries) === step.name) {
      last.entries.push(step)
      continue
    }
    // 上一组同名调用后面只隔着思考块时，把这些思考块并进去。
    let start = items.length
    while (start > 0 && items[start - 1].type === 'thinking') {
      start--
    }
    const before = items[start - 1]
    if (start < items.length && before?.type === 'tools' && toolName(before.entries) === step.name) {
      const between = items.splice(start) as ThinkingStep[]
      before.entries.push(...between, step)
      continue
    }
    items.push({ type: 'tools', entries: [step] })
  }
  return items
}

const toolName = (entries: (ToolStep | ThinkingStep)[]) =>
  entries.find((entry): entry is ToolStep => entry.type === 'tool')?.name

const stepKey = (step: Exclude<Step, ToolStep>, index: number) =>
  step.type === 'thinking' || step.type === 'text' || step.type === 'search'
    ? step.key
    : `${step.type}-${index}`

const StepItem = ({
  step,
  message,
  sources,
  streaming,
  isLast,
}: {
  step: Exclude<Step, ToolStep>
  message: AssistantMessage
  sources: Source[]
  streaming: boolean
  isLast: boolean
}) => {
  switch (step.type) {
    case 'thinking': {
      const lastBlock = step.blocks.at(-1)
      const thinking =
        streaming && lastBlock?.startedAt !== undefined && lastBlock.endedAt === undefined
      return (
        <ContentItem active={thinking}>
          <Markdown
            content={step.blocks.map((block) => block.thinking).join('')}
            loading={thinking}
            cacheKey={`${message.id}-${step.key}`}
            disableLink
          />
        </ContentItem>
      )
    }
    case 'text':
      return (
        <ContentItem active={false}>
          <Markdown
            content={step.markdown}
            loading={streaming && isLast}
            cacheKey={`${message.id}-${step.key}`}
            disableLink={false}
            sources={sources}
          />
        </ContentItem>
      )
    case 'search':
      return <SearchRow step={step} message={message} streaming={streaming} />
    case 'open':
      return <OpenRow step={step} sources={sources} />
    case 'find':
      return <FindRow step={step} />
    case 'read_link':
      return <ReadLinkRow step={step} />
    default:
      return null
  }
}

/** 思考或过程性文字：左侧圆点 + 竖线，小号 markdown */
const ContentItem = ({ children, active }: { children: ReactNode; active: boolean }) => (
  <div className={clsx(styles.content, 'ds-think-content', active && styles.live)}>{children}</div>
)

/** 搜索：普通搜索为「已阅读 N 个网页」，边想边搜为「搜索到 N 个网页」，点击打开搜索结果 */
const SearchRow = ({
  step,
  message,
  streaming,
}: {
  step: SearchStep
  message: AssistantMessage
  streaming: boolean
}) => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const wip = step.status === 'wip'
  const tick = useTicker(wip && step.queries.length > 1, 2000)
  const count = step.results.length
  const clickable = !wip && count > 0
  const panelEntry = `${message.id}-search-${step.key}`
  const failed = step.status === 'failed'
  const interrupted = failed && !streaming && message.status === 'stopped'

  let body: ReactNode
  if (wip) {
    body =
      step.queries.length > 0 ? (
        <>
          <span className={styles.prefix}>{t('toolSearchIntro')}</span>
          <span className={styles.query} key={tick}>
            {step.queries[tick % step.queries.length]}
          </span>
        </>
      ) : (
        <span>{t(isImageSearchKind(step.kind) ? 'imageSearching' : 'messageSearching')}</span>
      )
  } else if (interrupted) {
    body = <span>{t('searchStopped')}</span>
  } else if (failed) {
    body = <span>{t('toolSearchFail')}</span>
  } else if (count === 0) {
    body = (
      <span>{t(isDeepSearchKind(step.kind) ? 'toolSearchNoResult' : 'messageSearchNoResult')}</span>
    )
  } else {
    const text = t(
      isDeepSearchKind(step.kind)
        ? count === 1
          ? 'toolSearch1Result'
          : 'toolSearchResults'
        : count === 1
          ? 'messageSearchResult'
          : 'messageSearchResults',
      { count }
    )
    body = (
      <>
        <span className={styles.summary}>{text}</span>
        <SiteThumbnails sources={step.results} />
      </>
    )
  }
  return (
    <div
      className={clsx(
        styles.row,
        clickable && styles.clickable,
        entry === panelEntry && styles.active
      )}
      onClick={clickable ? () => toggleSearchPanel(panelEntry, step.results) : undefined}
    >
      <span className={styles.rowIcon}>
        {failed ? <IconSearchWarningOutline16 /> : <IconSearchOutline16 />}
      </span>
      {body}
    </div>
  )
}

/** 工具行外壳：左侧图标，右侧可换行的内容 */
const ToolRow = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <div className={styles.tool}>
    <span className={clsx(styles.rowIcon, styles.toolIcon)}>{icon}</span>
    <div className={styles.toolBody}>{children}</div>
  </div>
)

const PageLink = ({ page, failedTip }: { page: PageItem; failedTip?: string }) => (
  <span
    className={clsx(
      styles.page,
      page.status === 'failed' || !page.url ? styles.pageFailed : styles.pageDone
    )}
  >
    {page.status === 'failed' ? (
      <Tooltip content={failedTip}>
        <span className={styles.pageText}>{page.title}</span>
      </Tooltip>
    ) : (
      <a className={styles.pageText} href={page.url} target="_blank" rel="noreferrer">
        {page.title}
      </a>
    )}
    <span className={styles.pageIcon}>
      <IconRightUpOutline14 />
    </span>
  </span>
)

/** 边想边搜打开的网页：「浏览 N 个页面」+ 最多 5 个页面 */
const OpenRow = ({ step, sources }: { step: OpenStep; sources: Source[] }) => {
  const t = useTranslate()
  const allFailed = step.pages.every((page) => page.status === 'failed')
  const count = step.pages.length
  const intro = t(count === 1 ? 'toolOpenOneIntro' : 'toolOpensIntro', { count })
  const panelEntry = `open-${step.pages[0]?.id}`
  return (
    <ToolRow icon={allFailed ? <IconBrowseWarningOutline16 /> : <IconBrowseOutline16 />}>
      {allFailed ? (
        t('toolOpenFail')
      ) : (
        <>
          <span className={styles.intro}>{intro}</span>
          {step.pages.slice(0, 5).map((page) => (
            <PageLink key={page.id} page={page} failedTip={t('toolOpenFailTooltip')} />
          ))}
          {count > 5 ? (
            <span
              className={styles.chip}
              onClick={() =>
                toggleSearchPanel(
                  panelEntry,
                  sources.filter((source) => step.pages.some((page) => page.url === source.url))
                )
              }
            >
              {t('toolOpenViewAll')}
            </span>
          ) : null}
        </>
      )}
    </ToolRow>
  )
}

/** 边想边搜的页内查找：「查找关键词」+ 关键词标签 */
const FindRow = ({ step }: { step: FindStep }) => {
  const t = useTranslate()
  const allFailed = step.patterns.every((item) => item.status === 'failed')
  return (
    <ToolRow icon={allFailed ? <IconBrowseWarningOutline16 /> : <IconBrowseOutline16 />}>
      {allFailed ? (
        t('toolFindFail')
      ) : (
        <>
          <span className={styles.intro}>{t('toolFindIntro')}</span>
          {step.patterns.map((item) => (
            <Tooltip
              key={item.id}
              content={item.status === 'failed' ? t('toolFindFailTooltip') : null}
            >
              <span className={clsx(styles.chip, item.status === 'failed' && styles.chipFailed)}>
                {item.status === 'wip' ? null : (
                  <span className={styles.chipIcon}>
                    {item.status === 'failed' ? <IconCloseFill14 /> : <IconCheckedOutline14 />}
                  </span>
                )}
                <span className={styles.chipText}>{item.pattern}</span>
              </span>
            </Tooltip>
          ))}
        </>
      )}
    </ToolRow>
  )
}

/** 阅读用户消息中的链接：视图只保留仍在读取的链接。 */
const ReadLinkRow = ({ step }: { step: ReadLinkStep }) => {
  const t = useTranslate()
  return (
    <ToolRow icon={<IconLinkOutline16 />}>
      <span className={clsx(styles.intro, styles.shimmer)}>{t('readingLink')}</span>
      {step.links.map((link) => (
        <PageLink key={link.id} page={link} />
      ))}
    </ToolRow>
  )
}
