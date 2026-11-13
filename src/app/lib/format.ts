export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} s`
  return `${value.toFixed(1)} ms`
}

export function formatRate(value: number, digits = 2): string {
  return value.toFixed(digits)
}

export function formatTokenRate(value: number): string {
  return value >= 100 ? Math.round(value).toString() : value.toFixed(1)
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

export function formatCount(value: number): string {
  return Math.round(value).toString()
}

export function formatTokens(value: number): string {
  return Math.round(value).toString()
}
