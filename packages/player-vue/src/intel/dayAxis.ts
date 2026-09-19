/**
 * Day labels for a by-day chart's x axis, readable on a phone.
 *
 * Tom reported it through the app's own bug door on 18 Sep 2026: "a genuine
 * bug — I can't read the legend on the x axis", from an iPhone 402px wide,
 * on Working now.
 *
 * What was wrong. The axis was labelled "09-12", "09-13" — five characters of
 * 11px mono, seven of them. Rendered headless at 402 and at 340 CSS pixels,
 * ECharts fits four of the seven and silently drops the rest, so the chart
 * showed alternate days and the reader had to count bars to know which day a
 * bar was. The month was repeated on every label to say it once.
 *
 * What this does. The axis carries the DAY NUMBER only, which fits all seven
 * at 320px and wider, and the month moves into the chart's tag, where it is
 * said once — "by day · 12–18 Sep". Nothing is lost and nothing is guessed:
 * the tag names both ends, so a window spanning a month boundary reads
 * "29 Sep – 5 Oct" with the axis running 29, 30, 1, 2.
 *
 * Both functions take ISO 'YYYY-MM-DD' days, as /api/intel/working returns
 * them, and are pure so the labelling is testable without a browser.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthName(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)
}

/** '2026-09-12' → '12'. Leading zeros dropped: the axis is read, not parsed. */
export function dayTick(iso: string): string {
  return String(Number(iso.slice(8, 10)))
}

/**
 * The span the chart covers, said once: '12–18 Sep', or '29 Sep – 5 Oct'
 * across a month boundary. Empty for no days, and the bare day for one.
 */
export function dayRange(isoDays: string[]): string {
  if (!isoDays.length) return ''
  const first = isoDays[0]
  const last = isoDays[isoDays.length - 1]
  if (first === last) return `${dayTick(first)} ${monthName(first)}`
  if (monthName(first) === monthName(last)) return `${dayTick(first)}–${dayTick(last)} ${monthName(last)}`
  return `${dayTick(first)} ${monthName(first)} – ${dayTick(last)} ${monthName(last)}`
}
