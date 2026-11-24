import type { Node as MdAstNode, Nodes, Parent, RootContent, Root, Strong, Text } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  source: Source
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
  }
}

const text = (value: string): Text => ({ type: 'text', value })

export type ParseOptions = { sources: Source[] | undefined; disableLink: boolean }

/**
 * 解析正文（toMdAst / toMdAstIncremental 共用），并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 */
/** 解析并化简；ends 是化简前每个顶层块在 input 里的结束位置，顶层块与 ast.children 一一对应。 */
const parse = (
  input: string,
  { sources, disableLink }: ParseOptions
): { ast: Root; ends: number[] } => {
  const ast = fromMarkdown(input, {
    extensions: [
      // codeIndented 语法导致有前导空格的列表无法正常渲染
      { ...gfm(), disable: { null: ['codeIndented'] } },
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  const sourcesByUrl = new Map((sources ?? []).map((source) => [source.url, source]))
  // CommonMark 规则下，`**` 一侧贴标点、另一侧贴汉字时不算定界符（如 **“词”**后文），
  // 解析后会剩成文本里的 `**…**`；这里在单个文本节点内补回加粗。
  findAndReplace(ast, [
    /\*\*(?=\S)([^*\n]*?\S)\*\*/g,
    (_: string, inner: string): Strong => ({ type: 'strong', children: [text(inner)] }),
  ])
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    findAndReplace(
      ast,
      [
        /\[citation:(\d+)\]/g,
        (_: string, index: string): CitationNode | '' => {
          const source = sourcesByIndex.get(Number(index))
          return source ? { type: 'citation', source } : ''
        },
      ],
      { ignore: ['linkReference'] }
    )
  }
  // 顶层块化简后个数不变（脚注与定义只是换成段落），位置要在化简前取。
  const ends = ast.children.map((child) => child.position?.end.offset ?? -1)
  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset)
  // 先处理子节点，再按需把当前节点换成若干节点
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      ;(node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    }
    switch (node.type) {
      case 'link': {
        // 模型手写的 [[N]](url) 引用：按 URL 对上已登记的来源，换成角标
        const only = node.children.length === 1 ? node.children[0] : undefined
        if (only?.type === 'text' && /^\[?\d+\]?$/.test(only.value.trim())) {
          const source = sourcesByUrl.get(node.url)
          if (source) {
            return [{ type: 'citation', source } as CitationNode]
          }
        }
        return disableLink ? node.children : [node]
      }
      case 'delete': {
        // 解析器保证首尾定界符等长
        const delimiter = raw(node).match(/^~+/)?.[0] ?? ''
        return [text(delimiter), ...node.children, text(delimiter)]
      }
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return { ast, ends }
}

export function toMdAst(input: string, options: ParseOptions): Root {
  return parse(input, options).ast
}

/**
 * 流式增量解析的状态：source 是已冻结的前缀原文，nodes 是它对应的顶层块。
 * 冻结的块之后不会再因追加内容而改变，对象身份保持稳定，渲染层据此跳过重绘。
 */
export type IncrementalState = { key: string; source: string; nodes: RootContent[] }

/** 末尾保留不冻结的块数：正在写的块以及可能被续写、改判的上一块。 */
const UNFROZEN_TAIL = 2

const optionsKey = ({ sources, disableLink }: ParseOptions) =>
  `${disableLink ? 1 : 0}|${sources?.map((source) => `${source.index}=${source.url}`).join('\n') ?? ''}`

/**
 * 流式内容的增量解析：只重新解析冻结位置之后的原文，每次把除末尾两块外的块冻结。
 * 每次追加的耗时只跟尾部长度有关，而不是整段回答。内容不是上次的延续、来源或链接开关变化时从头解析。
 */
export function toMdAstIncremental(
  input: string,
  options: ParseOptions,
  previous: IncrementalState | null
): { ast: Root; state: IncrementalState } {
  const key = optionsKey(options)
  const base: IncrementalState =
    previous && previous.key === key && input.startsWith(previous.source)
      ? previous
      : { key, source: '', nodes: [] }
  const { ast: tail, ends } = parse(input.slice(base.source.length), options)
  const blocks = tail.children
  const count = blocks.length - UNFROZEN_TAIL
  const cut = count > 0 ? ends[count - 1] : -1
  let state = base
  if (cut > 0) {
    state = {
      key,
      source: input.slice(0, base.source.length + cut),
      nodes: [...base.nodes, ...blocks.slice(0, count)],
    }
  }
  const rest = blocks.slice(state.nodes.length - base.nodes.length)
  return { ast: { type: 'root', children: [...state.nodes, ...rest] }, state }
}
