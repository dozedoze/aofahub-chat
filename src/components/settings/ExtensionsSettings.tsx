import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslate, type TranslationKey, type TranslationParams } from '../../i18n/index.js'
import {
  applyMcpImport,
  currentTokenSecret,
  hostOf,
  isConflict,
  loadExtensions,
  newServerId,
  parseSkillFile,
  previewMcpImport,
  removeSecret,
  saveExtensions,
  setSecret,
  testServer,
  tokenSecretName,
  useExtensions,
  type ExtensionsConfig,
  type ImportPreview,
  type McpServer,
  type McpTransport,
  type Skill,
  type ToolInfo,
} from '../../services/extensions.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Extensions.module.css'

type Translate = ReturnType<typeof useTranslate>

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 保存类操作的统一收尾：冲突提示重试，其余把网关给的原因展示出来。 */
const reportFailure = (error: unknown) => {
  if (isConflict(error)) {
    showToast({ key: 'extConflict', type: 'error' })
  } else {
    showToast({ key: 'extSaveFailed', params: { message: errorMessage(error) }, type: 'error' })
  }
}

const SECRET_REF = /\$\{secret:([A-Za-z0-9_]{1,64})\}/g

const referencedSecrets = (server: McpServer): string[] =>
  [server.url, ...Object.values(server.headers)].flatMap((text) =>
    [...text.matchAll(SECRET_REF)].map((match) => match[1])
  )

/** 设置里的「扩展」：自己的 MCP 服务器和 Skill，配置跟账号走，换设备也在。 */
export const ExtensionsSettings = () => {
  const t = useTranslate()
  const status = useExtensions((state) => state.status)
  const config = useExtensions((state) => state.config)
  const [tab, setTab] = useState<'mcp' | 'skill'>('mcp')

  useEffect(() => {
    void loadExtensions().catch(() => {})
  }, [])

  if (!config) {
    return (
      <div className={styles.section}>
        {status === 'error' ? (
          <div className={styles.sectionHead}>
            <div className={clsx(styles.sectionText, styles.muted)}>{t('extLoadFailed')}</div>
            <Button
              variant="outlined"
              size="m"
              onClick={() => void loadExtensions().catch(() => {})}
            >
              {t('retry')}
            </Button>
          </div>
        ) : (
          <div className={styles.muted}>…</div>
        )}
      </div>
    )
  }

  return (
    <>
      <div role="tablist" className={styles.tabs}>
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={clsx(styles.tab, tab === item.value && styles.tabActive)}
            onClick={() => setTab(item.value)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      {tab === 'mcp' ? (
        <>
          {config.mcpEnabled ? null : <div className={styles.notice}>{t('extMcpDisabled')}</div>}
          <McpSection config={config} />
        </>
      ) : (
        <SkillsSection config={config} />
      )}
    </>
  )
}

const tabs: { value: 'mcp' | 'skill'; label: TranslationKey }[] = [
  { value: 'mcp', label: 'extMcpTitle' },
  { value: 'skill', label: 'extSkillTitle' },
]

const Section = ({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description: string
  actions: ReactNode
  children: ReactNode
}) => (
  <section className={styles.section}>
    <div className={styles.sectionHead}>
      <div className={styles.sectionText}>
        <div className={styles.sectionTitle}>{title}</div>
        <div className={styles.muted}>{description}</div>
      </div>
      <div className={styles.headActions}>{actions}</div>
    </div>
    {children}
  </section>
)

const ConfirmDelete = ({
  name,
  onConfirm,
  onCancel,
}: {
  name: string
  onConfirm: () => Promise<void>
  onCancel: () => void
}) => {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={name}
      className={styles.dialog}
      onClose={() => !busy && onCancel()}
      footer={
        <div className={styles.footer}>
          <Button variant="outlined" size="m" autoFocus disabled={busy} onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            size="m"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onConfirm().finally(() => setBusy(false))
            }}
          >
            {t('delete')}
          </Button>
        </div>
      }
    >
      {t('extDeleteDescription')}
    </Modal>
  )
}

// ---------- MCP ----------

const McpSection = ({ config }: { config: ExtensionsConfig }) => {
  const t = useTranslate()
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<McpServer | null>(null)
  const [tools, setTools] = useState<{ server: McpServer; tools: ToolInfo[] } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const save = async (servers: McpServer[]) => {
    try {
      await saveExtensions({ mcpServers: servers, skills: config.skills })
      return true
    } catch (error) {
      reportFailure(error)
      return false
    }
  }

  const runTest = async (server: McpServer) => {
    setTesting(server.id)
    try {
      const result = await testServer(server.id)
      if (result.ok) {
        setTools({ server, tools: result.tools })
      }
    } catch (error) {
      showToast({ key: 'extSaveFailed', params: { message: errorMessage(error) }, type: 'error' })
    } finally {
      setTesting(null)
    }
  }

  const remove = async (server: McpServer) => {
    const rest = config.mcpServers.filter((item) => item.id !== server.id)
    if (!(await save(rest))) {
      return
    }
    setDeleting(null)
    // 只清理再没有别的服务器引用的密钥
    const still = new Set(rest.flatMap(referencedSecrets))
    for (const name of new Set(referencedSecrets(server))) {
      if (!still.has(name) && config.secrets.includes(name)) {
        await removeSecret(name).catch(() => {})
      }
    }
    await loadExtensions().catch(() => {})
  }

  return (
    <Section
      title={t('extMcpTitle')}
      description={t('extMcpDescription')}
      actions={
        <>
          <Button variant="outlined" size="m" onClick={() => setImporting(true)}>
            {t('extImport')}
          </Button>
          <Button variant="outlined" size="m" onClick={() => setEditing('new')}>
            {t('extAdd')}
          </Button>
        </>
      }
    >
      {config.mcpServers.length === 0 ? (
        <div className={styles.empty}>{t('extEmpty')}</div>
      ) : (
        <ul className={styles.list}>
          {config.mcpServers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              config={config}
              testing={testing === server.id}
              onToggle={(enabled) =>
                void save(
                  config.mcpServers.map((item) =>
                    item.id === server.id ? { ...item, enabled } : item
                  )
                )
              }
              onTest={() => void runTest(server)}
              onEdit={() => setEditing(server)}
              onDelete={() => setDeleting(server)}
            />
          ))}
        </ul>
      )}
      {editing ? (
        <ServerDialog
          config={config}
          server={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? <ImportMcpDialog onClose={() => setImporting(false)} /> : null}
      {deleting ? (
        <ConfirmDelete
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      ) : null}
      {tools ? (
        <ToolsDialog server={tools.server} tools={tools.tools} onClose={() => setTools(null)} />
      ) : null}
    </Section>
  )
}

const statusText = (
  t: Translate,
  server: McpServer,
  config: ExtensionsConfig
): { text: string; error: boolean } => {
  const status = config.status[server.id]
  if (!status) {
    return { text: t('extStatusUnknown'), error: false }
  }
  return status.ok
    ? { text: t('extStatusOk', { count: status.toolCount }), error: false }
    : { text: t('extStatusFail', { message: status.error ?? '' }), error: true }
}

const ServerRow = ({
  server,
  config,
  testing,
  onToggle,
  onTest,
  onEdit,
  onDelete,
}: {
  server: McpServer
  config: ExtensionsConfig
  testing: boolean
  onToggle: (enabled: boolean) => void
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
}) => {
  const t = useTranslate()
  const status = statusText(t, server, config)
  return (
    <li className={styles.item}>
      <div className={styles.itemText}>
        <div className={styles.itemName}>{server.name}</div>
        <div className={styles.itemMeta}>{hostOf(server.url)}</div>
        <div className={clsx(styles.itemMeta, status.error && styles.itemMetaError)}>
          {status.text}
        </div>
      </div>
      <div className={styles.itemActions}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
          {t('extEnabled')}
        </label>
        <Button variant="outlined" size="m" disabled={testing} onClick={onTest}>
          {testing ? t('extTesting') : t('extTest')}
        </Button>
        <Button variant="outlined" size="m" onClick={onEdit}>
          {t('extEdit')}
        </Button>
        <Button variant="dangerOutlined" size="m" onClick={onDelete}>
          {t('delete')}
        </Button>
      </div>
    </li>
  )
}

const ServerDialog = ({
  config,
  server,
  onClose,
}: {
  config: ExtensionsConfig
  server: McpServer | null
  onClose: () => void
}) => {
  const t = useTranslate()
  const [name, setName] = useState(server?.name ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [transport, setTransport] = useState<McpTransport>(server?.transport ?? 'auto')
  const [allowWrite, setAllowWrite] = useState(server?.allowWrite ?? false)
  const [token, setToken] = useState('')
  const [clearToken, setClearToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const existingSecret = server ? currentTokenSecret(server) : null
  const hasToken = Boolean(existingSecret) && !clearToken

  const submit = async () => {
    setBusy(true)
    setError('')
    const id = server?.id ?? newServerId(name)
    const secretName = existingSecret ?? tokenSecretName(id)
    let wroteSecret = false
    try {
      const authKey =
        Object.keys(server?.headers ?? {}).find((key) => key.toLowerCase() === 'authorization') ??
        'Authorization'
      const headers = Object.fromEntries(
        Object.entries(server?.headers ?? {}).filter(([key]) => !clearToken || key !== authKey)
      )
      if (!clearToken && token) {
        await setSecret(secretName, token)
        wroteSecret = true
        headers[authKey] = `Bearer \${secret:${secretName}}`
      }
      const next: McpServer = {
        id,
        name: name.trim(),
        url: url.trim(),
        transport,
        headers,
        enabled: server?.enabled ?? true,
        allowWrite,
      }
      await saveExtensions({
        mcpServers: server
          ? config.mcpServers.map((item) => (item.id === server.id ? next : item))
          : [...config.mcpServers, next],
        skills: config.skills,
      })
      if (clearToken && existingSecret && config.secrets.includes(existingSecret)) {
        await removeSecret(existingSecret).catch(() => {})
        await loadExtensions().catch(() => {})
      }
      showToast({ key: 'extSaved' })
      onClose()
    } catch (caught) {
      if (wroteSecret && !server) {
        await removeSecret(secretName).catch(() => {})
      }
      if (isConflict(caught)) {
        reportFailure(caught)
        onClose()
      } else {
        setError(errorMessage(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={server ? t('extEdit') : t('extAdd')}
      className={styles.dialog}
      closable
      onClose={() => !busy && onClose()}
      footer={
        <div className={styles.footer}>
          <Button variant="outlined" size="m" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            size="m"
            disabled={busy || !name.trim() || !url.trim()}
            onClick={() => void submit()}
          >
            {busy ? t('extSaving') : t('extSave')}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('extServerName')}</span>
          <input
            className={styles.input}
            value={name}
            maxLength={40}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('extServerUrl')}</span>
          <input
            className={styles.input}
            value={url}
            placeholder="https://example.com/mcp"
            spellCheck={false}
            autoCapitalize="off"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('extServerTransport')}</span>
          <Select
            ariaLabel={t('extServerTransport')}
            value={transport}
            options={[
              { value: 'auto', label: t('extTransportAuto') },
              { value: 'http', label: t('extTransportHttp') },
              { value: 'sse', label: t('extTransportSse') },
            ]}
            onChange={setTransport}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('extToken')}</span>
          <div className={styles.tokenRow}>
            <input
              className={styles.input}
              type="password"
              autoComplete="off"
              value={token}
              disabled={!config.secretsEnabled || clearToken}
              placeholder={hasToken ? t('extTokenSet') : t('extTokenPlaceholder')}
              onChange={(event) => setToken(event.target.value)}
            />
            {hasToken ? (
              <Button variant="outlined" size="m" onClick={() => setClearToken(true)}>
                {t('extTokenClear')}
              </Button>
            ) : null}
          </div>
          {config.secretsEnabled ? null : (
            <span className={styles.muted}>{t('extTokenNeedKey')}</span>
          )}
        </div>
        <div className={styles.field}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={allowWrite}
              onChange={(event) => setAllowWrite(event.target.checked)}
            />
            {t('extAllowWrite')}
          </label>
          <span className={styles.muted}>{t('extAllowWriteHint')}</span>
        </div>
        {error ? <div className={styles.formError}>{error}</div> : null}
      </div>
    </Modal>
  )
}

const ToolsDialog = ({
  server,
  tools,
  onClose,
}: {
  server: McpServer
  tools: ToolInfo[]
  onClose: () => void
}) => {
  const t = useTranslate()
  const hidden = tools.filter((tool) => !tool.exposed).length
  return (
    <Modal
      title={t('extToolsTitle', { name: server.name })}
      className={styles.dialog}
      closable
      onClose={onClose}
    >
      {tools.length === 0 ? (
        <div className={styles.muted}>{t('extToolsEmpty')}</div>
      ) : (
        <>
          {hidden > 0 ? (
            <div className={clsx(styles.notice, styles.muted)}>
              {t('extToolsHiddenHint', { count: hidden })}
            </div>
          ) : null}
          <ul className={styles.tools}>
            {tools.map((tool) => (
              <li key={tool.name} className={styles.tool}>
                <div className={styles.toolHead}>
                  {tool.name}
                  {tool.readOnly ? (
                    <span className={styles.badge}>{t('extToolReadOnly')}</span>
                  ) : null}
                  <span className={clsx(styles.badge, tool.exposed && styles.badgeOn)}>
                    {tool.exposed ? t('extToolExposed') : t('extToolHidden')}
                  </span>
                </div>
                {tool.description ? <div className={styles.muted}>{tool.description}</div> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}

const MAX_IMPORT_BYTES = 200_000

const ImportMcpDialog = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const edit = (value: string) => {
    setText(value)
    setPreview(null)
    setError('')
  }

  const runPreview = async () => {
    setBusy(true)
    setError('')
    try {
      setPreview(await previewMcpImport(text))
    } catch (caught) {
      setPreview(null)
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await applyMcpImport(text)
      showToast({
        key: 'extImportDone',
        params: { count: result.added.length + result.updated.length },
      })
      onClose()
    } catch (caught) {
      if (isConflict(caught)) {
        reportFailure(caught)
        onClose()
      } else {
        setError(errorMessage(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const blocked = Boolean(preview && preview.secretsToCreate.length > 0 && !preview.secretsEnabled)
  const importable = Boolean(preview && preview.servers.length > 0 && !blocked)

  return (
    <Modal
      title={t('extImportMcpTitle')}
      className={styles.dialog}
      closable
      onClose={() => !busy && onClose()}
      footer={
        <div className={styles.footer}>
          <Button
            variant="outlined"
            size="m"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {t('extImportChooseFile')}
          </Button>
          <Button
            variant="outlined"
            size="m"
            disabled={busy || !text.trim()}
            onClick={() => void runPreview()}
          >
            {t('extImportPreview')}
          </Button>
          <Button size="m" disabled={busy || !importable} onClick={() => void apply()}>
            {t('extImportApply')}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <div className={styles.muted}>{t('extImportMcpHint')}</div>
        <textarea
          className={clsx(styles.textarea, styles.textareaTall)}
          value={text}
          spellCheck={false}
          placeholder='{ "mcpServers": { "name": { "url": "https://..." } } }'
          onChange={(event) => edit(event.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) {
              return
            }
            if (file.size > MAX_IMPORT_BYTES) {
              setError(t('extSaveFailed', { message: file.name }))
              return
            }
            void file.text().then(edit)
          }}
        />
        {preview ? <PreviewSummary t={t} preview={preview} blocked={blocked} /> : null}
        {error ? <div className={styles.formError}>{error}</div> : null}
      </div>
    </Modal>
  )
}

const PreviewSummary = ({
  t,
  preview,
  blocked,
}: {
  t: Translate
  preview: ImportPreview
  blocked: boolean
}) => {
  const lines: { key: TranslationKey; params?: TranslationParams; error?: boolean }[] = []
  if (preview.servers.length === 0) {
    lines.push({ key: 'extImportNothing', error: true })
  } else {
    lines.push({
      key: 'extImportWillAdd',
      params: {
        count: preview.servers.length,
        names: preview.servers.map((s) => s.name).join(', '),
      },
    })
  }
  if (preview.secretsToCreate.length > 0) {
    lines.push({ key: 'extImportSecrets', params: { count: preview.secretsToCreate.length } })
  }
  if (preview.secretsNeeded.length > 0) {
    lines.push({ key: 'extImportNeeded', params: { names: preview.secretsNeeded.join(', ') } })
  }
  for (const skipped of preview.skipped) {
    lines.push({ key: 'extImportSkipped', params: { name: skipped.name, reason: skipped.reason } })
  }
  if (blocked) {
    lines.push({ key: 'extImportNoSecretKey', error: true })
  }
  return (
    <div className={styles.lines}>
      {lines.map((line, index) => (
        <div key={index} className={line.error ? styles.formError : undefined}>
          {t(line.key, line.params)}
        </div>
      ))}
    </div>
  )
}

// ---------- Skill ----------

const SkillsSection = ({ config }: { config: ExtensionsConfig }) => {
  const t = useTranslate()
  const [editing, setEditing] = useState<Skill | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Skill | null>(null)
  const [imported, setImported] = useState<Partial<Skill> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const save = async (skills: Skill[]) => {
    try {
      await saveExtensions({ mcpServers: config.mcpServers, skills })
      return true
    } catch (error) {
      reportFailure(error)
      return false
    }
  }

  const pickFile = async (file: File) => {
    try {
      const parsed = await parseSkillFile(file)
      if (!parsed) {
        showToast({ key: 'extSkillImportFailed', type: 'error' })
        return
      }
      if (parsed.ignored > 0) {
        showToast({ key: 'extSkillImportIgnored', params: { count: parsed.ignored } })
      }
      setImported({ name: parsed.name, description: parsed.description, body: parsed.body })
      setEditing('new')
    } catch {
      showToast({ key: 'extSkillImportFailed', type: 'error' })
    }
  }

  return (
    <Section
      title={t('extSkillTitle')}
      description={t('extSkillDescription')}
      actions={
        <>
          <Button variant="outlined" size="m" onClick={() => fileRef.current?.click()}>
            {t('extImport')}
          </Button>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              setImported(null)
              setEditing('new')
            }}
          >
            {t('extSkillNew')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.zip,text/markdown,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void pickFile(file)
              }
            }}
          />
        </>
      }
    >
      {config.skills.length === 0 ? (
        <div className={styles.empty}>{t('extEmpty')}</div>
      ) : (
        <ul className={styles.list}>
          {config.skills.map((skill) => (
            <li key={skill.id} className={styles.item}>
              <div className={styles.itemText}>
                <div className={styles.itemName}>{skill.name}</div>
                <div className={styles.itemMeta}>{skill.description}</div>
              </div>
              <div className={styles.itemActions}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={(event) =>
                      void save(
                        config.skills.map((item) =>
                          item.id === skill.id ? { ...item, enabled: event.target.checked } : item
                        )
                      )
                    }
                  />
                  {t('extEnabled')}
                </label>
                <Button variant="outlined" size="m" onClick={() => setEditing(skill)}>
                  {t('extEdit')}
                </Button>
                <Button variant="dangerOutlined" size="m" onClick={() => setDeleting(skill)}>
                  {t('delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <SkillDialog
          config={config}
          skill={editing === 'new' ? null : editing}
          draft={editing === 'new' ? imported : null}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDelete
          name={deleting.name}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (await save(config.skills.filter((item) => item.id !== deleting.id))) {
              setDeleting(null)
            }
          }}
        />
      ) : null}
    </Section>
  )
}

const SkillDialog = ({
  config,
  skill,
  draft,
  onClose,
}: {
  config: ExtensionsConfig
  skill: Skill | null
  draft: Partial<Skill> | null
  onClose: () => void
}) => {
  const t = useTranslate()
  const seed = skill ?? draft
  const [name, setName] = useState(seed?.name ?? '')
  const [description, setDescription] = useState(seed?.description ?? '')
  const [body, setBody] = useState(seed?.body ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true)
    setError('')
    const next: Skill = {
      id: skill?.id ?? '',
      name: name.trim(),
      description: description.trim(),
      body,
      enabled: skill?.enabled ?? true,
    }
    try {
      await saveExtensions({
        mcpServers: config.mcpServers,
        skills: skill
          ? config.skills.map((item) => (item.id === skill.id ? next : item))
          : [...config.skills, next],
      })
      showToast({ key: 'extSaved' })
      onClose()
    } catch (caught) {
      if (isConflict(caught)) {
        reportFailure(caught)
        onClose()
      } else {
        setError(errorMessage(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={skill ? t('extEdit') : t('extSkillNew')}
      className={styles.dialog}
      closable
      onClose={() => !busy && onClose()}
      footer={
        <div className={styles.footer}>
          <Button variant="outlined" size="m" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            size="m"
            disabled={busy || !name.trim() || !description.trim() || !body.trim()}
            onClick={() => void submit()}
          >
            {busy ? t('extSaving') : t('extSave')}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('extSkillName')}</span>
          <input
            className={styles.input}
            value={name}
            maxLength={63}
            autoFocus
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('extSkillDesc')}</span>
          <input
            className={styles.input}
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('extSkillBody')}</span>
          <textarea
            className={clsx(styles.textarea, styles.textareaTall)}
            value={body}
            maxLength={32000}
            spellCheck={false}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        {error ? <div className={styles.formError}>{error}</div> : null}
      </div>
    </Modal>
  )
}
