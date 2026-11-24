/**
 * 复制选区时，把渲染后的公式换回 TeX 源码。
 * KaTeX 的 HTML 结构直接复制出来是上标下标打散的乱码，源码在 MathML 的 annotation 里。
 * 只在选区里确实包含公式时介入，其余复制保持浏览器默认行为。
 */
const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"]'

const toSource = (root: ParentNode) => {
  let replaced = false
  for (const formula of root.querySelectorAll('.katex-display, .katex')) {
    const tex = formula.querySelector(TEX_ANNOTATION)?.textContent
    if (!tex) {
      continue
    }
    const display = formula.classList.contains('katex-display')
    formula.replaceWith(document.createTextNode(display ? `\n$$\n${tex}\n$$\n` : `$${tex}$`))
    replaced = true
  }
  return replaced
}

const onCopy = (event: ClipboardEvent) => {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || !event.clipboardData) {
    return
  }
  const container = document.createElement('div')
  for (let index = 0; index < selection.rangeCount; index++) {
    container.append(selection.getRangeAt(index).cloneContents())
  }
  if (!container.querySelector('.katex')) {
    return
  }
  if (!toSource(container)) {
    return
  }
  // 挂到屏幕外再读 innerText，才能保留段落、列表之间的换行
  container.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:pre-wrap'
  document.body.append(container)
  const text = container.innerText
  container.remove()
  event.clipboardData.setData('text/plain', text)
  event.preventDefault()
}

export const installMathCopy = () => {
  document.addEventListener('copy', onCopy)
  return () => document.removeEventListener('copy', onCopy)
}
