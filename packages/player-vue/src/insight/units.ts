// ============================================================================
// units.ts — unit-suffix formatting shared by the insight widgets
//
// One number, one unit, one string. The only interesting part is that a unit
// written in the plural has to come back singular when the value is exactly 1:
// the widgets were rendering "1 people".
// ============================================================================

const IRREGULAR: Record<string, string> = {
  people: 'person',
  children: 'child',
  men: 'man',
  women: 'woman',
  teeth: 'tooth',
}

// Singularise a plural unit word. Units of three characters or fewer are left
// alone — they are abbreviations, and "ms" must never become "m".
export function singulariseUnit(unit: string): string {
  const irregular = IRREGULAR[unit.toLowerCase()]
  if (irregular) {
    // Carry the original capitalisation of the first letter, nothing more.
    return unit[0] === unit[0].toUpperCase()
      ? irregular[0].toUpperCase() + irregular.slice(1)
      : irregular
  }

  if (unit.length <= 3 || !unit.endsWith('s') || unit.endsWith('ss')) return unit
  if (unit.endsWith('ies')) return `${unit.slice(0, -3)}y`
  if (/(ch|sh|s|x|z)es$/.test(unit)) return unit.slice(0, -2)
  return unit.slice(0, -1)
}

// "3 people" · "1 person" · "12%" · "4.5 hours". A value with no unit is just
// the number; "%" binds tight to it.
export function formatWithUnit(value: number, unit?: string): string {
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1)
  if (!unit) return n
  if (unit === '%') return `${n}%`
  return `${n} ${value === 1 ? singulariseUnit(unit) : unit}`
}
