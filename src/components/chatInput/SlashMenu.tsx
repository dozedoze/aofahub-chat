import { useEffect, useRef } from 'react'
import type { SlashCommand } from './slashCommands.js'
import styles from './SlashMenu.module.css'

/** 输入框上方的斜杠命令菜单；键盘导航由输入框处理，这里只负责展示与点击 */
export const SlashMenu = ({
  commands,
  active,
  label,
  onHover,
  onSelect,
}: {
  commands: readonly SlashCommand[]
  active: number
  label: string
  onHover: (index: number) => void
  onSelect: (command: SlashCommand) => void
}) => {
  const activeRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <ul className={styles.menu} role="listbox" aria-label={label} id="slash-menu">
      {commands.map((command, index) => (
        <li
          key={command.id}
          ref={index === active ? activeRef : undefined}
          id={`slash-${command.id}`}
          role="option"
          aria-selected={index === active}
          className={index === active ? styles.itemActive : styles.item}
          // mousedown 阶段选择，避免输入框先失焦
          onMouseDown={(event) => {
            event.preventDefault()
            onSelect(command)
          }}
          onMouseMove={() => onHover(index)}
        >
          <span className={styles.slug}>/{command.slug}</span>
          <span className={styles.label}>{command.label}</span>
        </li>
      ))}
    </ul>
  )
}
