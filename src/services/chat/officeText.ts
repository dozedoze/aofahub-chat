import { strFromU8, unzipSync } from 'fflate'

/**
 * 在浏览器里把 OOXML 文档（xlsx / docx / pptx）转成纯文本，随提问内联发送。
 * 网关的模型（如 grok）不接收文件，只能读到文本，所以表格、文档必须在这里先解出来。
 * 旧的二进制格式（xls / doc / ppt）和 pdf 不在此处理。
 */

/** 单个压缩条目解压后的上限，防止恶意压缩包撑爆内存 */
const MAX_ENTRY_BYTES = 40 * 1024 * 1024

export const OFFICE_EXTS = new Set(['xlsx', 'docx', 'pptx'])

const parseXml = (text: string): Document => {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XML')
  }
  return doc
}

const children = (node: Element) => Array.from(node.children)

const descendants = (node: Element | Document, name: string) =>
  Array.from(node.getElementsByTagNameNS('*', name))

const unzipEntries = (bytes: Uint8Array, wanted: (path: string) => boolean) =>
  unzipSync(bytes, {
    filter: (entry) => wanted(entry.name) && entry.originalSize <= MAX_ENTRY_BYTES,
  })

const readXml = (files: Record<string, Uint8Array>, path: string) => {
  const entry = files[path]
  return entry ? parseXml(strFromU8(entry)) : null
}

/** 文本里的制表符与换行会破坏表格结构，压成空格 */
const flat = (text: string) => text.replace(/[\t\r\n]+/g, ' ').trim()

// ---------- xlsx ----------

/** 列字母转从 0 开始的序号：A→0，AA→26 */
const columnIndex = (ref: string) => {
  let index = 0
  for (const char of ref) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) {
      break
    }
    index = index * 26 + (code - 64)
  }
  return index - 1
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

const isDateFormatCode = (code: string) =>
  /[ymdhs]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ''))

/** 每个样式序号是否为日期/时间格式 */
const readDateStyles = (styles: Document | null) => {
  const flags: boolean[] = []
  if (!styles) {
    return flags
  }
  const custom = new Map<number, string>()
  for (const fmt of descendants(styles, 'numFmt')) {
    custom.set(Number(fmt.getAttribute('numFmtId')), fmt.getAttribute('formatCode') ?? '')
  }
  const cellXfs = descendants(styles, 'cellXfs')[0]
  for (const xf of cellXfs ? children(cellXfs) : []) {
    const id = Number(xf.getAttribute('numFmtId'))
    const code = custom.get(id)
    flags.push(code === undefined ? BUILTIN_DATE_FORMATS.has(id) : isDateFormatCode(code))
  }
  return flags
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Excel 序列日期（1900 系统）转可读字符串；仅在整数部分合理时转换 */
const formatExcelDate = (serial: number) => {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) {
    return String(serial)
  }
  const date = new Date(Math.round((serial - 25569) * 86_400_000))
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  const hasTime = serial % 1 !== 0
  return hasTime
    ? `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    : day
}

const richText = (node: Element) =>
  descendants(node, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('')

const readSharedStrings = (doc: Document | null) =>
  doc ? descendants(doc, 'si').map((si) => richText(si)) : []

const resolveTarget = (target: string) =>
  target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`

const cellText = (cell: Element, shared: string[], dateStyles: boolean[]) => {
  const type = cell.getAttribute('t')
  const value = descendants(cell, 'v')[0]?.textContent ?? ''
  if (type === 'inlineStr') {
    return richText(cell)
  }
  if (type === 's') {
    return shared[Number(value)] ?? ''
  }
  if (type === 'b') {
    return value === '1' ? 'TRUE' : 'FALSE'
  }
  if (type === 'str' || type === 'e' || type === 'd') {
    return value
  }
  if (value !== '' && dateStyles[Number(cell.getAttribute('s'))]) {
    return formatExcelDate(Number(value))
  }
  return value
}

const sheetToText = (doc: Document, shared: string[], dateStyles: boolean[]) => {
  const lines: string[] = []
  for (const row of descendants(doc, 'row')) {
    const cells: string[] = []
    let next = 0
    for (const cell of children(row).filter((el) => el.localName === 'c')) {
      const ref = cell.getAttribute('r')
      const index = ref ? columnIndex(ref) : next
      while (cells.length < index) {
        cells.push('')
      }
      cells[index] = flat(cellText(cell, shared, dateStyles))
      next = index + 1
    }
    while (cells.length > 0 && cells[cells.length - 1] === '') {
      cells.pop()
    }
    lines.push(cells.join('\t'))
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines.join('\n')
}

const xlsxToText = (bytes: Uint8Array) => {
  const files = unzipEntries(
    bytes,
    (path) =>
      path === 'xl/workbook.xml' ||
      path === 'xl/_rels/workbook.xml.rels' ||
      path === 'xl/sharedStrings.xml' ||
      path === 'xl/styles.xml' ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(path)
  )
  const workbook = readXml(files, 'xl/workbook.xml')
  if (!workbook) {
    throw new Error('Not a workbook')
  }
  const rels = new Map<string, string>()
  for (const rel of descendants(
    readXml(files, 'xl/_rels/workbook.xml.rels') ?? workbook,
    'Relationship'
  )) {
    rels.set(rel.getAttribute('Id') ?? '', resolveTarget(rel.getAttribute('Target') ?? ''))
  }
  const shared = readSharedStrings(readXml(files, 'xl/sharedStrings.xml'))
  const dateStyles = readDateStyles(readXml(files, 'xl/styles.xml'))
  const sections: string[] = []
  for (const sheet of descendants(workbook, 'sheet')) {
    const relId = sheet.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'id'
    )
    const path = (relId && rels.get(relId)) || ''
    const doc = readXml(files, path)
    if (!doc) {
      continue
    }
    const body = sheetToText(doc, shared, dateStyles)
    sections.push(`## Sheet: ${sheet.getAttribute('name') ?? ''}\n${body || '(empty)'}`)
  }
  return sections.join('\n\n')
}

// ---------- docx / pptx ----------

/** 按 OOXML 段落、表格结构展开文本：p 换行，tc 以制表符分隔，tr 换行 */
const walkText = (node: Element, out: string[]) => {
  switch (node.localName) {
    case 't':
      out.push(node.textContent ?? '')
      return
    case 'tab':
      out.push('\t')
      return
    case 'br':
    case 'cr':
      out.push('\n')
      return
    default:
  }
  for (const child of children(node)) {
    walkText(child, out)
  }
  if (node.localName === 'p' || node.localName === 'tr') {
    out.push('\n')
  } else if (node.localName === 'tc') {
    out.push('\t')
  }
}

const textOf = (doc: Document) => {
  const out: string[] = []
  walkText(doc.documentElement, out)
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const docxToText = (bytes: Uint8Array) => {
  const files = unzipEntries(bytes, (path) => path === 'word/document.xml')
  const doc = readXml(files, 'word/document.xml')
  if (!doc) {
    throw new Error('Not a document')
  }
  return textOf(doc)
}

const slideNumber = (path: string) => Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0)

const pptxToText = (bytes: Uint8Array) => {
  const files = unzipEntries(bytes, (path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
  const slides = Object.keys(files).sort((a, b) => slideNumber(a) - slideNumber(b))
  if (slides.length === 0) {
    throw new Error('Not a presentation')
  }
  return slides
    .map((path) => `## Slide ${slideNumber(path)}\n${textOf(parseXml(strFromU8(files[path])))}`)
    .join('\n\n')
}

/** 提取 OOXML 文档文本；格式损坏或不是对应文档时抛出 */
export const extractOfficeText = async (ext: string, blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  switch (ext) {
    case 'xlsx':
      return xlsxToText(bytes)
    case 'docx':
      return docxToText(bytes)
    case 'pptx':
      return pptxToText(bytes)
    default:
      throw new Error(`Unsupported office format: ${ext}`)
  }
}
