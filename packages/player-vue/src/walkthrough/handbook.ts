/**
 * handbook — the Handbook page's data layer.
 *
 * TWO READINGS OF ONE SOURCE. A capability is authored exactly once, in
 * tools/walkthrough/walks/*.json. The walkthrough engine reads it as a
 * just-in-time clip; this module reads the same compiled pack as a map —
 * every capability written out in prose, whether or not it has a clip.
 *
 * Nothing here is a hand-written list of what the dashboard can do. The
 * entries come from pack.json, which the compiler refuses to emit unless
 * every entry names a data-walk anchor that still exists in the live .vue
 * source. Delete the button and the build fails; the page cannot go stale
 * behind the product.
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

export const PLACE_LINKS: Record<string, PlaceLink> = {
  'node-home': (node) => (node ? `/org/${node}` : null),
  'node-insights': (node) => (node ? `/org/${node}/insights` : null),
  'class-detail': () => '/schools/classes',
  'admin-invites': () => '/admin/invites',
  library: () => '/',
}

/** The router target for an entry, or null when the reader has nowhere to go. */
export function placeLink(entry: HandbookEntry, nodeId: string | null | undefined): string | null {
  const resolve = PLACE_LINKS[entry.place.route]
  return resolve ? resolve(nodeId ?? '') : null
}

export interface HandbookEntry {
  id: string
  title: string
  section: HandbookSectionId
  personas: WalkPersona[]
  keywords: string[]
  place: { route: string; kinds?: string[] }
  anchor: string
  /** The walk id where a clip exists for this capability, else null. */
  walk: string | null
  what: string
  where: string
  how: string[]
  note?: string
}

const entries = (pack as unknown as { handbook: HandbookEntry[] }).handbook

/** Every handbook entry, in section then title order. */
export function handbookEntries(): HandbookEntry[] {
  const order = HANDBOOK_SECTIONS.map((s) => s.id)
  return [...entries].sort((a, b) =>
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
