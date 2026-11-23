const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

const toDate = (value: string | number | Date): Date | null => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDate = (
  value: string | number | Date,
  separator: '/' | '-' = '-'
): string | null => {
  const date = toDate(value)
  if (!date) {
    return null
  }
  return [pad(date.getFullYear(), 4), pad(date.getMonth() + 1), pad(date.getDate())].join(separator)
}

export const monthKey = (value: string | number | Date): string | null => {
  const date = toDate(value)
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}` : null
}

export const formatTokens = (n: number): string => {
  if (n >= 1e9) {
    return `${(n / 1e9).toFixed(n % 1e9 ? 1 : 0)}B`
  }
  if (n >= 1e6) {
    return `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`
  }
  if (n >= 1e3) {
    return `${(n / 1e3).toFixed(n % 1e3 ? 1 : 0)}k`
  }
  return String(n)
}
