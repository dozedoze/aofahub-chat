export type SlashCommand = {
  id: string
  /** 输入 / 之后用来匹配的名字，如 new、model gpt-5 */
  slug: string
  label: string
  run: () => void
}

/** 菜单只在「单行、以 / 开头」的输入里出现，普通文字与多行内容不会误触发。 */
export const getSlashQuery = (text: string): string | null =>
  /^\/[^\n]*$/.test(text) ? text.slice(1).trim().toLowerCase() : null

/** 名字前缀命中的排前面，其次是名字或说明里包含关键词的。 */
export const filterSlashCommands = (commands: readonly SlashCommand[], query: string) => {
  if (!query) {
    return [...commands]
  }
  const starts: SlashCommand[] = []
  const contains: SlashCommand[] = []
  for (const command of commands) {
    const slug = command.slug.toLowerCase()
    if (slug.startsWith(query)) {
      starts.push(command)
    } else if (slug.includes(query) || command.label.toLowerCase().includes(query)) {
      contains.push(command)
    }
  }
  return [...starts, ...contains]
}
