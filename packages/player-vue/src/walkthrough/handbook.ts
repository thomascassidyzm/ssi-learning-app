/**
 * handbook — the Handbook page's data layer.
 *
 * THE PROSE LIVES IN THE CODE. A capability's description is an HTML comment
 * directly above the element that IS the capability, in the .vue source, so
 * the agent changing what a button does is already looking at the sentence
 * describing it — Tom, 2026-09-07: "the models built the prose, so at the
 * point of making any change they can update the prose too".
 *
 * tools/walkthrough/compile.mjs reads those comments, pins each one to a
 * fingerprint of the element it describes, and emits them into pack.json.
 * Nothing here is a hand-written list of what the dashboard can do: delete
 * the button and the build fails, change what it does without rewriting its
 * sentence and the build fails naming the capability.
 *
 * Founder rulings, 2026-09-07:
 *  - it is called the HANDBOOK, never Training. A handbook is what you look
 *    in when you are stuck; training is something you sit through.
 *  - EVERY capability in the school shows, badged by role — not only the
 *    ones the reader can personally use. A teacher seeing what an admin can
 *    do is how they know who to ask.
 */
import pack from './pack.json'
import type { WalkPersona } from './useWalkthrough'

/** The six sections, in reading order. Lockstep-checked by the compiler. */
export const HANDBOOK_SECTIONS = [
  { id: 'getting-people-in', title: 'Getting people in' },
  { id: 'running-classes', title: 'Running classes' },
  { id: 'seeing-progress', title: 'Seeing how it is going' },
  { id: 'courses-and-content', title: 'Courses and content' },
  { id: 'your-school', title: 'Your school' },
  { id: 'your-own-account', title: 'Your own account' },
] as const

export type HandbookSectionId = (typeof HANDBOOK_SECTIONS)[number]['id']

/**
 * THE THREE MOMENTS, in frequency order — the page's PRIMARY grouping since
 * Tom's ruling of 2026-09-16: "the whole list is a bit overwhelming". A
 * section says what a capability is ABOUT; a moment says WHEN you reach for
 * it, which is the question a teacher with a class in front of them is
 * actually asking. Every entry carries exactly one, authored in its own
 * HANDBOOK comment and lockstep-checked by the compiler. The six sections
 * survive as the compendium's index behind "Read the lot".
 */
export const HANDBOOK_MOMENTS = [
  { id: 'setting-up', title: 'Setting up', blurb: 'Done once, at the start of a term or a school.' },
  { id: 'every-lesson', title: 'Every lesson', blurb: 'The handful you reach for with a class in front of you.' },
  { id: 'something-wrong', title: 'When something looks wrong', blurb: 'A number that surprises you, a link that never arrived, a class gone quiet.' },
] as const

export type HandbookMomentId = (typeof HANDBOOK_MOMENTS)[number]['id']

/**
 * Whose capability each one is. One label per persona the engine knows —
 * the compiler fails the build if a persona here and a persona in
 * tools/walkthrough/lib.mjs / the WalkPersona union ever disagree, so a
 * capability can never render an empty pill.
 *
 * A tutor is a groupless teacher, not a separate role — every gate that
 * admits a teacher admits a tutor, so they read the Teacher badge.
 */
export const ROLE_BADGES: Record<WalkPersona, string> = {
  admin: 'SSi admin',
  leader: 'Leader',
  school_admin: 'School admin',
  teacher: 'Teacher',
  learner: 'Learner',
}

/**
 * Where each place actually lives, as a router target. One entry per
 * KNOWN_PLACES route — the compiler fails the build if the runtime learns a
 * place this map has never heard of, so "Take me there" can never point at
 * nowhere. `node` is the group or school the reader belongs to.
 */
type PlaceLink = (node: string) => string | null

// `intel` is the intelligence surface: every question page and verb there
// carries the same description mechanism, and its home is the first question.
export const PLACE_LINKS: Record<string, PlaceLink> = {
  'node-home': (node) => (node ? `/org/${node}` : null),
  'node-insights': (node) => (node ? `/org/${node}/insights` : null),
  'class-detail': () => '/schools/classes',
  dashboard: () => '/schools',
  teachers: () => '/schools/teachers',
  students: () => '/schools/students',
  classes: () => '/schools/classes',
  settings: () => '/schools/settings',
  // SettingsScreen.vue is the player's Settings overlay, not a schools route.
  'player-settings': () => '/?screen=settings',
  setup: () => '/schools/setup',
  'schools-list': () => '/schools/all',
  analytics: () => '/schools/analytics',
  upgrade: () => '/schools/upgrade',
  inbox: () => '/schools/inbox',
  'admin-invites': () => '/admin/invites',
  intel: () => '/intel',
  library: () => '/',
}

/** The router target for an entry, or null when the reader has nowhere to go. */
export function placeLink(entry: HandbookEntry, nodeId: string | null | undefined): string | null {
  const resolve = PLACE_LINKS[entry.place.route]
  return resolve ? resolve(nodeId ?? '') : null
}

export type HandbookSurface = 'schools' | 'intel'

export interface HandbookEntry {
  /** Slug of the title — the compiler's own key, stable while the title is. */
  id: string
  title: string
  /** The .vue file the description lives in, beside the thing it describes. */
  source?: string
  section: HandbookSectionId
  /** WHEN a reader reaches for this. Exactly one, authored, compiler-gated. */
  moment: HandbookMomentId
  personas: WalkPersona[]
  /**
   * Which surface the capability lives on. The compiler reads it from the
   * anchor's namespace: data-walk is the schools dashboard, data-intel the
   * intelligence surface. Absent means schools, so an older pack still reads.
   */
  surface?: HandbookSurface
  keywords: string[]
  place: { route: string; kinds?: string[] }
  /**
   * Every router path whose page actually renders this entry's anchor —
   * DERIVED by the compiler from the router table and the .vue import
   * closure, never authored. This is what the per-page Show-me list keys on:
   * `place` is one authored name, and the 2026-09-16 audit found 39 of 80
   * school-leader entries whose place resolves to a route their anchor is not
   * on. An empty list means the anchor is not reachable from any routed view.
   */
  routes?: string[]
  anchor: string
  /** The walk id where a clip exists for this capability, else null. */
  walk: string | null
  what: string
  where: string
  how: string[]
  note?: string
}

const entries = (pack as unknown as { handbook: HandbookEntry[] }).handbook

interface PackWalk { id: string; personas: WalkPersona[]; place: { route: string; kinds?: string[] }; steps: Array<{ anchor: string }> }
const packWalks = (pack as unknown as { walks: PackWalk[] }).walks

/**
 * THE CLIPS THAT SHOW A CAPABILITY (job #627, 2026-09-14). Tom: "the handbook
 * still appears to be pointing to the prose, rather than the clips … we
 * certainly have clips for most of the common things already."
 *
 * A capability has a clip when a walk steps on its anchor — the `walk:` line
 * in its HANDBOOK comment names one by hand, and every other walk in the pack
 * whose steps land on the same element counts too, so "Choose what role
 * someone arrives as" plays the invite walk that passes through that field
 * without anyone authoring a link. Only walks for the reader's own persona:
 * a walk steps real anchors, and a school admin's walk would point a teacher
 * at controls they do not have. Ids only, in pack order with the named walk
 * first — the view localises through walkById.
 */
export function clipsFor(entry: HandbookEntry, persona: WalkPersona): string[] {
  const stepping = packWalks.filter((w) => w.steps.some((s) => s.anchor === entry.anchor)).map((w) => w.id)
  const ids = [...new Set([...(entry.walk ? [entry.walk] : []), ...stepping])]
  return ids.filter((id) => packWalks.find((w) => w.id === id)?.personas.includes(persona))
}

/**
 * The entries for ONE surface, sorted for the page. One compiled pack carries
 * both the schools dashboard's capabilities and the intelligence surface's;
 * the schools Handbook page shows its own only, and the intelligence surface
 * reads its own on its own pages. Absent surface means schools, so an older
 * pack still reads.
 */
export function handbookEntries(surface: HandbookSurface = 'schools'): HandbookEntry[] {
  const order = HANDBOOK_SECTIONS.map((s) => s.id)
  return entries
    .filter((e) => (e.surface ?? 'schools') === surface)
    .sort((a, b) =>
      order.indexOf(a.section) - order.indexOf(b.section) || a.title.localeCompare(b.title))
}

/** Entries grouped into the sections that actually have any. */
export function handbookSections(list: HandbookEntry[] = handbookEntries()): Array<{
  id: HandbookSectionId
  title: string
  entries: HandbookEntry[]
}> {
  return HANDBOOK_SECTIONS
    .map((s) => ({ id: s.id, title: s.title, entries: list.filter((e) => e.section === s.id) }))
    .filter((s) => s.entries.length > 0)
}

/**
 * The reader's own persona, from the roles the rest of the app already
 * gates on (composables/useUserRole.ts): ssi_admin is the platform operator,
 * a govt_admin governs a group subtree and reads as a leader, and a tutor is
 * a groupless teacher. This decides which entries carry "yours", never which
 * entries are shown — the page shows everything by ruling.
 */
export function viewerPersona(
  platformRole: string | null | undefined,
  educationalRole: string | null | undefined,
): WalkPersona {
  if (platformRole === 'ssi_admin') return 'admin'
  if (educationalRole === 'govt_admin') return 'leader'
  if (educationalRole === 'school_admin') return 'school_admin'
  if (educationalRole === 'teacher' || educationalRole === 'tutor') return 'teacher'
  return 'learner'
}

/** True when this capability is the reader's own to use. */
export function isMine(entry: HandbookEntry, persona: WalkPersona): boolean {
  return entry.personas.includes(persona)
}

/**
 * The badges a reader sees on an entry that is NOT theirs — whose it is, so
 * they know who to ask. Nothing is badged as "mine": the reader knows.
 */
export function badgesFor(entry: HandbookEntry, persona: WalkPersona): string[] {
  if (isMine(entry, persona)) return []
  return entry.personas
    .filter((p) => p !== 'learner')
    .map((p) => ROLE_BADGES[p])
}

/**
 * The same dumb local word match the learner hub uses: every query word must
 * appear in the entry's title, keywords or prose. No index, no network, no
 * tokens, works offline.
 */
export function searchHandbook(query: string, list: HandbookEntry[] = handbookEntries()): HandbookEntry[] {
  const words = query.toLowerCase().split(/[^a-z0-9']+/i).filter(Boolean)
  if (!words.length) return list
  const scored = list.map((e) => {
    const label = `${e.title} ${e.keywords.join(' ')}`.toLowerCase()
    const body = `${e.what} ${e.where} ${e.how.join(' ')} ${e.note ?? ''}`.toLowerCase()
    let score = 0
    for (const word of words) {
      if (label.includes(word)) score += 3
      else if (body.includes(word)) score += 1
      else return { e, score: -1 }
    }
    return { e, score }
  })
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.e)
}

/** Entries grouped into the moments that actually have any, in frequency order. */
export function handbookMoments(list: HandbookEntry[] = handbookEntries()): Array<{
  id: HandbookMomentId
  title: string
  blurb: string
  entries: HandbookEntry[]
}> {
  return HANDBOOK_MOMENTS
    .map((m) => ({ id: m.id, title: m.title, blurb: m.blurb, entries: list.filter((e) => e.moment === m.id) }))
    .filter((m) => m.entries.length > 0)
}

/** The page's own moment order — the rank an entry sorts by within a page. */
export function momentRank(entry: HandbookEntry): number {
  const i = HANDBOOK_MOMENTS.findIndex((m) => m.id === entry.moment)
  return i < 0 ? HANDBOOK_MOMENTS.length : i
}

/**
 * THE CAPABILITIES THAT LIVE ON ONE PAGE (job #5, 2026-09-16). Tom: "putting
 * the clips on the relevant page as well should be good — Show me can be a
 * list of clips that are relevant to each page — the handbook is the
 * compendium of everything."
 *
 * Membership is the compiler-derived `routes` — the anchor is on THIS page or
 * it is not — so nothing here navigates and nothing defers. That matters:
 * the audit of 2026-09-16 found the Handbook's own "Take me there" landing on
 * pages the entry's anchor is not on, and deferred walks dying on a redirect.
 * A list built on the page it describes cannot have either failure.
 *
 * `matchedPaths` is the router's own matched records, so a nested route reads
 * as its own page and its parent's. Falls back to the authored `place` only
 * for an anchor no routed view reaches, or an older pack with no routes.
 */
export function entriesOnPage(
  matchedPaths: string[],
  persona: WalkPersona,
  place?: string,
  list: HandbookEntry[] = handbookEntries(),
): HandbookEntry[] {
  const here = new Set(matchedPaths)
  const on = list.filter((e) =>
    e.routes?.length ? e.routes.some((r) => here.has(r)) : (place ? e.place.route === place : false))
  return on
    .filter((e) => isMine(e, persona))
    .sort((a, b) => momentRank(a) - momentRank(b) || a.title.localeCompare(b.title))
}

/**
 * The page's Show-me list: one row per clip that shows a capability standing
 * on this page, in the page's own moment order, deduped so a walk that covers
 * two of them is offered once. Ids only — the caller localises.
 */
export function showMeOnPage(
  matchedPaths: string[],
  persona: WalkPersona,
  place?: string,
  list: HandbookEntry[] = handbookEntries(),
): string[] {
  const ids: string[] = []
  for (const e of entriesOnPage(matchedPaths, persona, place, list)) {
    for (const id of clipsFor(e, persona)) if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * YOUR NEXT THREE (job #5, 2026-09-16) — above the fold on the Handbook.
 *
 * Read off the SAME account state the node home's Last Step banner and the
 * noticing rules already read: the /api/groups/:id/home payload, nothing new.
 * No pupils yet, no teachers yet, classes but nobody playing — each of those
 * is already a fact the dashboard has in hand, so this is a second READER of
 * one state model, never a second model.
 *
 * With no signal at all, the answer is the top three of "Every lesson" for
 * this reader — the handful that matter, which is the honest default.
 */
export interface HandbookState {
  learnerCount?: number
  teacherCount?: number
  classCount?: number
  activeClasses7d?: number
  /** Minutes this week across the subtree; 0 with learners present is the quiet-week signal. */
  inAppMinutes7d?: number
}

/** The state the Next-three reads, lifted out of a node-home payload. */
export function stateFromHome(home: unknown): HandbookState {
  const h = home as {
    node?: { rollup?: { learnerCount?: number; teacherCount?: number; classCount?: number } }
    classPractice?: { activeClasses7d?: number; inAppMinutes7d?: number; classCount?: number }
  } | null | undefined
  return {
    learnerCount: h?.node?.rollup?.learnerCount,
    teacherCount: h?.node?.rollup?.teacherCount,
    classCount: h?.node?.rollup?.classCount ?? h?.classPractice?.classCount,
    activeClasses7d: h?.classPractice?.activeClasses7d,
    inAppMinutes7d: h?.classPractice?.inAppMinutes7d,
  }
}

/**
 * Which capability each signal points at, in the order the signals are read.
 * Same predicates the banner and the noticing rules use, said once: no
 * teachers is school-needs-first-teacher; no pupils is the Last Step banner's
 * own "the last step is your pupils"; classes that practised before and have
 * stopped is quiet-subtree.
 */
const NEXT_SIGNALS: Array<{ when: (s: HandbookState) => boolean; anchors: string[] }> = [
  { when: (s) => s.classCount === 0, anchors: ['setup-add-class-row', 'verb-new-class', 'verb-add-class'] },
  { when: (s) => s.teacherCount === 0, anchors: ['teachers-invite-link', 'verb-invite-person', 'teacher-named-seat'] },
  { when: (s) => s.learnerCount === 0, anchors: ['class-join-link', 'verb-invite-student', 'class-student-add'] },
  { when: (s) => (s.learnerCount ?? 0) > 0 && s.inAppMinutes7d === 0, anchors: ['dash-class-card-play', 'class-page-play', 'classes-row-play'] },
  { when: (s) => (s.classCount ?? 0) > 0 && s.activeClasses7d === 0, anchors: ['insights-org-quiet', 'class-practice'] },
]

export function nextThree(
  state: HandbookState,
  persona: WalkPersona,
  list: HandbookEntry[] = handbookEntries(),
): HandbookEntry[] {
  const mine = list.filter((e) => isMine(e, persona))
  const picked: HandbookEntry[] = []
  const take = (e: HandbookEntry | undefined): void => {
    if (e && !picked.some((p) => p.id === e.id)) picked.push(e)
  }
  for (const sig of NEXT_SIGNALS) {
    if (picked.length >= 3) break
    if (!sig.when(state)) continue
    for (const anchor of sig.anchors) {
      const hit = mine.find((e) => e.anchor === anchor)
      if (hit) { take(hit); break }
    }
  }
  // No signal fired, or a signal named a capability this reader does not have:
  // the top of "Every lesson" is the honest default, never an empty card.
  if (picked.length < 3) {
    for (const e of mine.filter((e) => e.moment === 'every-lesson')) {
      if (picked.length >= 3) break
      take(e)
    }
  }
  return picked.slice(0, 3)
}
