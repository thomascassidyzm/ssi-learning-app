/**
 * SCHOOL WEEK — the primitive Class Insights is told in.
 *
 * Tom's ruling, 2026-09-16: "today / 7 days / 30 days is the wrong primitive
 * for schools who work in week-units". A school's unit of work is the WEEK:
 * Monday morning to Friday afternoon, planned a week at a time, reviewed a
 * week at a time. So insights offers exactly two windows — THIS WEEK (Monday
 * 00:00 local to now) and LAST WEEK (the previous complete Monday–Sunday) —
 * and the trend is Monday-anchored weekly bars. No sliding windows: a
 * rolling "last 7 days" straddles two lessons of two different weeks and
 * cannot be talked about in a staff meeting.
 *
 * LOCAL means the school's own clock, so the boundary is computed in an IANA
 * time zone (the client sends its own, `?tz=`), never in a fixed offset:
 * a fixed offset shifts every boundary by an hour twice a year, which would
 * make the Sunday-night edge of the DST weeks wrong in both directions.
 * Everything here is pure and takes `now` explicitly — the tests walk it
 * across a month boundary and across both UK DST changes.
 */

export const DEFAULT_TIME_ZONE = 'Europe/London'

export type WeekWindowId = 'this_week' | 'last_week'

export interface WeekRange {
  startMs: number
  endMs: number
}

const MS_PER_DAY = 86_400_000

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Wall-clock parts of an instant, in `timeZone`. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  // en-GB renders midnight as hour 24 in some ICU builds; normalise to 0.
  const hour = get('hour') % 24
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute'), second: get('second') }
}

/** The zone's UTC offset (ms) at an instant. */
function offsetMsAt(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms
}

/**
 * The instant at which a given WALL CLOCK time occurs in `timeZone`. Two
 * passes: guess with the offset at the naive instant, then re-read the offset
 * at the candidate — which is what makes the spring-forward and fall-back
 * weekends land on the right instant rather than an hour out.
 */
export function wallClockToMs(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = naive - offsetMsAt(naive, timeZone)
  const second_ = naive - offsetMsAt(first, timeZone)
  return second_
}

/** Monday 00:00 local, on or before `now`. */
export function startOfWeekMs(now: number, timeZone: string): number {
  const p = zonedParts(now, timeZone)
  // Weekday of the LOCAL calendar date, computed off a UTC noon anchor so no
  // offset arithmetic can tip it into the neighbouring day.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day, 12)).getUTCDay() // 0=Sun
  const backDays = (dow + 6) % 7 // Monday = 0
  const mondayDate = new Date(Date.UTC(p.year, p.month - 1, p.day, 12) - backDays * MS_PER_DAY)
  return wallClockToMs(timeZone, mondayDate.getUTCFullYear(), mondayDate.getUTCMonth() + 1, mondayDate.getUTCDate())
}

/** Monday 00:00 local, `weeksBack` whole weeks before this week's Monday. */
export function startOfWeekBack(now: number, timeZone: string, weeksBack: number): number {
  let ms = startOfWeekMs(now, timeZone)
  for (let i = 0; i < weeksBack; i++) {
    // Step back 36 hours from the Monday — safely into the Saturday of the
    // previous week — then re-anchor. Subtracting 7×24h instead would land on
    // 23:00 or 01:00 across a DST change and drift the boundary; landing
    // mid-Saturday cannot be tipped out of its week by an hour either way.
    ms = startOfWeekMs(ms - 36 * 3_600_000, timeZone)
  }
  return ms
}

/**
 * The two windows. THIS WEEK runs from Monday 00:00 to NOW — a week in
 * progress reads as far as it has got, never padded to Sunday night. LAST
 * WEEK is the previous complete Monday–Sunday.
 */
export function weekRange(id: WeekWindowId, now: number, timeZone: string): WeekRange {
  const thisMonday = startOfWeekMs(now, timeZone)
  if (id === 'this_week') return { startMs: thisMonday, endMs: now }
  const lastMonday = startOfWeekBack(now, timeZone, 1)
  return { startMs: lastMonday, endMs: thisMonday }
}

/**
 * DEFAULT WINDOW — one constant, deliberately (judgement call, job #989):
 * on a Monday or a Tuesday "this week" is one or two lessons old and says
 * almost nothing, so the page opens on LAST WEEK, the week the school has
 * actually just finished and is reviewing. Wednesday onwards it opens on the
 * week in progress.
 */
export const LAST_WEEK_DEFAULT_THROUGH_WEEKDAY = 2 // 1=Mon, 2=Tue

export function defaultWeekWindow(now: number, timeZone: string): WeekWindowId {
  const p = zonedParts(now, timeZone)
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day, 12)).getUTCDay() // 0=Sun
  const isoDow = dow === 0 ? 7 : dow
  return isoDow <= LAST_WEEK_DEFAULT_THROUGH_WEEKDAY ? 'last_week' : 'this_week'
}

/**
 * `count` Monday-anchored week boundaries, oldest first — `count` buckets of
 * [start, end). The newest bucket is the week containing `now` (its end is
 * next Monday, so a part-week's bars stay in their own bucket rather than
 * being smeared). A week with no play is an empty week, never interpolated.
 */
export function weekBuckets(now: number, timeZone: string, count: number): WeekRange[] {
  const starts: number[] = []
  for (let back = count - 1; back >= 0; back--) starts.push(startOfWeekBack(now, timeZone, back))
  const out: WeekRange[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length
      ? starts[i + 1]
      : startOfWeekMs(starts[i] + 8 * MS_PER_DAY, timeZone) // next Monday
    out.push({ startMs: starts[i], endMs: end })
  }
  return out
}

/** "6–12 May" style label for a week, in the school's own zone. */
export function weekLabel(range: WeekRange, timeZone: string): string {
  const start = zonedParts(range.startMs, timeZone)
  const endInstant = range.endMs - 1000
  const end = zonedParts(endInstant, timeZone)
  const month = (m: number): string => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  if (start.month === end.month) return `${start.day}–${end.day} ${month(start.month)}`
  return `${start.day} ${month(start.month)} – ${end.day} ${month(end.month)}`
}

/** Days of history a read must cover to fill `weeks` buckets plus the part-week. */
export function fetchDaysForWeeks(now: number, timeZone: string, weeks: number): number {
  const oldest = startOfWeekBack(now, timeZone, weeks - 1)
  return Math.ceil((now - oldest) / MS_PER_DAY) + 1
}
