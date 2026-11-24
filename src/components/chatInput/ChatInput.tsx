import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  IconPaperclipOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { isDeepseekModel } from '../../services/auth.js'
import {
  canToggleThinking,
  setModel,
  setThinking,
  thinkingDisplay,
  useSettings,
} from '../../services/settings.js'
import { getLatestReplyThinking } from '../../services/chat/thinking.js'
import { useIsMobile } from '../../app/viewport.js'
import { newChat, sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import { enqueueMessage } from '../../services/chat/queue.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { openSessionSearch, openShortcuts } from '../shortcuts/shortcutsState.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Select } from '../base/Select.js'
import { Tooltip } from '../base/Tooltip.js'
import { ContextMeter } from './ContextMeter.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { QueueChips } from './QueueChips.js'
import { SlashMenu } from './SlashMenu.js'
import { filterSlashCommands, getSlashQuery, type SlashCommand } from './slashCommands.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 输入框：自适应高度的文本框 + 文件 + 深度思考开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const model = useSettings((state) => state.model)
  const models = useSettings((state) => state.models)
  const thinkingMode = useSettings((state) => state.thinkingModes[state.model])
  const deepseek = isDeepseekModel(model)
  const latestReplyThinking = useChatStore((state) =>
    sessionId === null || !Object.hasOwn(state.sessionCache, sessionId)
      ? undefined
      : getLatestReplyThinking(state.sessionCache[sessionId])
  )
  const thinking = useSettings((state) => thinkingDisplay(state, sessionId, latestReplyThinking))
  const [slashActive, setSlashActive] = useState(0)
  // 用户按 Esc 关闭菜单时记下当时的文字，文字再变化才会重新打开
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory) {
      return
    }
    const error = addDraftFiles(sessionId, files)
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        retryDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  const slashQuery = getSlashQuery(text)
  const allSlashCommands = useMemo<SlashCommand[]>(() => {
    const commands: SlashCommand[] = [
      { id: 'new', slug: 'new', label: t('slashNew'), run: newChat },
      {
        id: 'search',
        slug: 'search',
        label: t('slashSearch'),
        run: openSessionSearch,
      },
      {
        id: 'settings',
        slug: 'settings',
        label: t('slashSettings'),
        run: () => openSettings('general'),
      },
      {
        id: 'extensions',
        slug: 'extensions',
        label: t('slashExtensions'),
        run: () => openSettings('extensions'),
      },
      { id: 'shortcuts', slug: 'shortcuts', label: t('slashShortcuts'), run: openShortcuts },
    ]
    if (canToggleThinking(thinkingMode)) {
      commands.splice(1, 0, {
        id: 'think',
        slug: 'think',
        label: t('slashThink'),
        run: () => setThinking(sessionId, !thinking),
      })
    }
    for (const id of models) {
      commands.push({
        id: `model:${id}`,
        slug: `model ${id}`,
        label: `${t('slashModel')} · ${id}`,
        run: () => setModel(id),
      })
    }
    return commands
  }, [t, thinkingMode, thinking, sessionId, models])
  const slashCommands = useMemo(
    () => (slashQuery === null ? [] : filterSlashCommands(allSlashCommands, slashQuery)),
    [allSlashCommands, slashQuery]
  )
  const slashOpen = slashCommands.length > 0 && slashDismissed !== text && !importingHistory
  const slashIndex = Math.min(slashActive, slashCommands.length - 1)
  const runSlash = (command: SlashCommand) => {
    setText('')
    setSlashActive(0)
    command.run()
    textareaRef.current?.focus({ preventScroll: true })
  }

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  const thinkingToggle = canToggleThinking(thinkingMode) ? (
    <Tooltip
      content={t(thinkingMode === 'auto' ? 'thinkingAutoTooltip' : 'deactivatedThinkTooltip')}
    >
      <button
        type="button"
        className={clsx(styles.toggle, thinking && styles.selected)}
        aria-label={t('thinkingSwitch')}
        aria-pressed={thinking}
        onClick={() => setThinking(sessionId, !thinking)}
      >
        <IconThinkOutline14 />
        <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
      </button>
    </Tooltip>
  ) : (
    // 不能切换思考的模型：只展示这个对话实际的思考状态
    <Tooltip
      content={t(
        thinkingMode === 'always'
          ? 'thinkingAlwaysTooltip'
          : thinkingMode === 'none'
            ? 'thinkingNoneTooltip'
            : 'thinkingUnknownTooltip'
      )}
    >
      <button
        type="button"
        className={clsx(styles.toggle, styles.readonly, thinking && styles.selected)}
        aria-label={t('thinkingSwitch')}
        aria-pressed={thinking}
        aria-disabled
      >
        <IconThinkOutline14 />
        <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
      </button>
    </Tooltip>
  )

  return (
    <div className={styles.anchor}>
      {slashOpen ? (
        <SlashMenu
          commands={slashCommands}
          active={slashIndex}
          label={t('slashMenuLabel')}
          onHover={setSlashActive}
          onSelect={runSlash}
        />
      ) : null}
      <div
        className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            textareaRef.current?.focus({ preventScroll: true })
          }
        }}
      >
        <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
        <QueueChips sessionId={sessionId} />
        <div className={styles.textareaWrapper}>
          <textarea
            ref={textareaRef}
            data-chat-input
            className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
            placeholder={t(streaming ? 'chatInputPlaceholderQueue' : 'chatInputPlaceholderChat')}
            role={slashOpen ? 'combobox' : undefined}
            aria-expanded={slashOpen || undefined}
            aria-controls={slashOpen ? 'slash-menu' : undefined}
            aria-activedescendant={slashOpen ? `slash-${slashCommands[slashIndex].id}` : undefined}
            rows={2}
            // 移动端不自动聚焦，避免一打开就弹出键盘
            autoFocus={!isMobile}
            disabled={importingHistory}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setSlashActive(0)
            }}
            onMouseDown={(event) => {
              // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
              if (
                isMobile &&
                event.button === 0 &&
                document.activeElement !== event.currentTarget
              ) {
                event.preventDefault()
                event.currentTarget.focus({ preventScroll: true })
              }
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return
              }
              if (slashOpen) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const step = event.key === 'ArrowDown' ? 1 : -1
                  setSlashActive((slashIndex + step + slashCommands.length) % slashCommands.length)
                  return
                }
                if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                  event.preventDefault()
                  runSlash(slashCommands[slashIndex])
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSlashDismissed(text)
                  return
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                // 回答生成中：纯文字先排队，本轮正常结束后自动发送
                if (streaming && sessionId !== null) {
                  if (text.trim() && attachments.length === 0) {
                    enqueueMessage(sessionId, text)
                    setText('')
                  }
                  return
                }
                send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length > 0) {
                event.preventDefault()
                acceptFiles(files)
              }
            }}
          />
          {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
          <div className={styles.mirror} aria-hidden>
            {`${text}\n`}
          </div>
        </div>
        <div className={styles.functionRow}>
          {/* 深度思考开关，tooltip 在按钮上方 */}
          <div ref={togglesRef} className={styles.toggles}>
            <Select
              ariaLabel={t('model')}
              value={model}
              options={(models.length ? models : ['auto']).map((id) => ({ value: id, label: id }))}
              onChange={setModel}
            />
            {thinkingToggle}
          </div>
          <div className={styles.right}>
            <ContextMeter sessionId={sessionId} draftText={text} draftAttachments={attachments} />
            {deepseek ? (
              <VoiceButton
                status={voice.status}
                disabled={!voice.available}
                seconds={voice.seconds}
                onClick={() => {
                  if (voice.status !== 'idle' || !useChatStore.getState().importingHistory) {
                    void voice.toggle()
                  }
                }}
              />
            ) : null}
            <IconButton
              size="m"
              tone="primary"
              icon={<IconPaperclipOutline16 />}
              tooltip={t('uploadFile')}
              disabled={importingHistory}
              onClick={() => fileInputRef.current?.click()}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={(event) => {
                acceptFiles(Array.from(event.target.files ?? []))
                event.target.value = ''
              }}
            />
            {streaming && sessionId ? (
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t('chatInputStopButtonTooltip')}
                onClick={() => {
                  stopReadAloud()
                  stopReply(sessionId)
                }}
              >
                <IconStopFill16 />
              </button>
            ) : (
              <button
                type="button"
                className={clsx(styles.sendButton, !canSend && styles.disabled)}
                aria-label={t('send')}
                aria-disabled={!canSend}
                onClick={send}
              >
                <IconSendOutline16 />
              </button>
            )}
          </div>
        </div>
        {dragging ? <DragMask /> : null}
      </div>
    </div>
  )
}
