export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const hexToRgba = (hex: string): [number, number, number, number] => {
  const normalized = hex.replace('#', '')
  const safe = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => char + char)
        .join('')
    : normalized.padEnd(6, '0').slice(0, 6)

  return [
    Number.parseInt(safe.slice(0, 2), 16),
    Number.parseInt(safe.slice(2, 4), 16),
    Number.parseInt(safe.slice(4, 6), 16),
    255,
  ]
}

export const rgbaToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((value) => clamp(value, 0, 255).toString(16).padStart(2, '0')).join('')}`
