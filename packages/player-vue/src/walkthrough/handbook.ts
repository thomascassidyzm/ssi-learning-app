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
type PlaceLink = (node: string, classId?: string) => string | null

export const PLACE_LINKS: Record<string, PlaceLink> = {
  'node-home': (node) => (node ? `/org/${node}` : null),
  'node-insights': (node) => (node ? `/org/${node}/insights` : null),
  // A class-detail capability lives on ONE class's page. With a class to hand
  // — the reader's first — Show me can land on it and the anchors resolve;
  // without one, the list is the honest nearest place.
  'class-detail': (_node, classId) => (classId ? `/schools/classes/${classId}` : '/schools/classes'),
  dashboard: () => '/schools',
  teachers: () => '/schools/teachers',
  students: () => '/schools/students',
  classes: () => '/schools/classes',
  settings: () => '/schools/settings',
  setup: () => '/schools/setup',
  'schools-list': () => '/schools/all',
  analytics: () => '/schools/analytics',
  upgrade: () => '/schools/upgrade',
  'admin-invites': () => '/admin/invites',
  library: () => '/',
}

/** The router target for an entry, or null when the reader has nowhere to go. */
export function placeLink(entry: HandbookEntry, nodeId: string | null | undefined, classId?: string | null): string | null {
  const resolve = PLACE_LINKS[entry.place.route]
  return resolve ? resolve(nodeId ?? '', classId ?? undefined) : null
}

/**
 * Where "Show me" can take a reader and play the demo (job #386): the entry
 * has a derived demo, the demo is offered to the reader's own role — the same
 * entitlement walksFor applies, so a teacher is never shown an admin's
 * buttons ringed on a page that hides them — and there is a page to go to.
 * A class-detail demo additionally needs a real class to stand on, because
 * its anchors exist on one class's page and nowhere else.
 */
export function demoLink(
  entry: HandbookEntry,
  persona: WalkPersona,
  walkPersonas: WalkPersona[] | null,
  nodeId: string | null | undefined,
  classId?: string | null,
): string | null {
  if (!entry.walk || !walkPersonas || !walkPersonas.includes(persona)) return null
  if (entry.place.route === 'class-detail' && !classId) return null
  return placeLink(entry, nodeId, classId)
}

export interface HandbookEntry {
  /** Slug of the title — the compiler's own key, stable while the title is. */
  id: string
  title: string
  /** The .vue file the description lives in, beside the thing it describes. */
  source?: string
  section: HandbookSectionId
  personas: WalkPersona[]
  keywords: string[]
  place: { route: string; kinds?: string[] }
  anchor: string
  /**
   * The demo — DERIVED by the compiler, never typed: the walk whose steps
   * anchor this capability, or null while nobody has authored one.
   */
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

/**
 * The words a question is made of that say nothing about WHICH capability:
 * "how do I", "can we", "where is the". A reader types a sentence; the
 * search above wants keywords and refuses on any word it cannot find.
 */
const QUESTION_WORDS = new Set([
  'how', 'do', 'does', 'did', 'i', 'we', 'you', 'me', 'my', 'our', 'your', 'a', 'an', 'the', 'to', 'of', 'in',
  'on', 'for', 'from', 'is', 'are', 'it', 'its', 'this', 'that', 'can', 'could', 'should', 'would', 'want',
  'need', 'what', 'where', 'when', 'which', 'why', 'who', 'get', 'go', 'be', 'and', 'or', 'with', 'there',
  'please', 'help', 'find', 'see', 'set', 'up', 'not', 'no', 'any', 'some', 'have', 'has', 'if', 'so',
])

/**
 * The FREE deflection behind the ask box (job #386): the entry most likely
 * to already answer a question typed as a sentence, or null when nothing is
 * close. Content words only, and a hit on at least half of them — so
 * "how do I remove a teacher from my school" finds "Remove a teacher from
 * your school" while "purple elephants trampoline" finds nothing. Same
 * scoring weights as searchHandbook; no index, no network, no tokens.
 */
export function suggestHandbook(question: string, list: HandbookEntry[] = handbookEntries()): HandbookEntry | null {
  const words = [...new Set(question.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 1 && !QUESTION_WORDS.has(w)))]
  if (!words.length) return null
  let best: { e: HandbookEntry; score: number; hits: number } | null = null
  for (const e of list) {
    const label = `${e.title} ${e.keywords.join(' ')}`.toLowerCase()
    const body = `${e.what} ${e.where} ${e.how.join(' ')} ${e.note ?? ''}`.toLowerCase()
    let score = 0
    let hits = 0
    for (const w of words) {
      if (label.includes(w)) { score += 3; hits += 1 }
      else if (body.includes(w)) { score += 1; hits += 1 }
    }
    if (hits * 2 < words.length || hits === 0) continue
    if (!best || score > best.score) best = { e, score, hits }
  }
  return best?.e ?? null
}
