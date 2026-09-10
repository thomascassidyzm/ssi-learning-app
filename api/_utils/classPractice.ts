/**
 * CLASS PRACTICE — where a class's own practice actually lives.
 *
 * `class_sessions` was the original play-as-class log, inserted client-side by
 * LearningPlayer. On 2026-08-19 the play-as-class spine was re-anchored (owner
 * ruling, see composables/schools/useClassSessionStore.ts): a class is a
 * first-class learner with its own learner id. Nothing has written
 * `class_sessions` since (verified live 2026-09-10: max(started_at) =
 * 2026-08-19T20:18Z).
 *
 * WHAT THE CLASS ACCOUNT CAN AND CANNOT WRITE (verified live 2026-09-10, job
 * #159). Three records exist and only one of them sees whole-class play:
 *
 *   - `player_events` — the raw diary: one row per clip played, per round
 *     completed, per tap, batch-posted by the player for EVERY kind of
 *     account including the class account. Chepstow's class accounts wrote
 *     1,610 `audio_play` rows in the week the board said 0h. This is the only
 *     ledger that records whole-class play, and it carries the audio id of
 *     every clip, which joins to the phrase text in both languages.
 *   - `learner_speaking_opportunities` — the playback ledger and the ONE
 *     definition of a minute across the app (founder ruling 2026-08-19,
 *     migrations 20260908c/d). Written by `bump_speaking_opportunities`, whose
 *     first line checks `learners.user_id = auth.uid()`. A class account's
 *     user_id is the literal `class-learner:<classId>`, nobody's login, so the
 *     write is REFUSED (42501) and the player logs it to the console. Zero
 *     rows for any class account, ever, estate-wide.
 *   - `sessions` — the older session log. For class accounts it is inverted:
 *     of Chepstow's 19 real class lessons this week NONE has a row, and the 8
 *     rows that exist belong to app opens with no play (duration 0). Its
 *     duration is therefore not read here at all. A whole-class practice TIME
 *     does not exist in any ledger and no proxy is substituted for it — the
 *     board says so in words instead (founder instruction 2026-09-10: "Report
 *     an honest gap rather than a proxy anywhere the data is not there").
 *
 * So this module answers three things off the live records:
 *   - did the class practise, and when — the enrollment cursor stamp OR a clip
 *     in the diary, whichever is newer;
 *   - PHRASES SPOKEN — Tom's term for cycles played: one per `target2` clip,
 *     the same count the ledger banks as `opportunities` for own accounts
 *     (equality checked on five learner-days: 1,743 = 1,743). Without VAD
 *     this is phrases the class was prompted and played back, not heard;
 *   - WHAT they practised — the phrase-by-count list, audio id → phrase text.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'

export const CLASS_PRACTICE_WINDOW_DAYS = 7
/** PostgREST caps a single response at 1,000 rows; page the diary read. */
const DIARY_PAGE = 1000
const DIARY_MAX_PAGES = 20

export interface ClassPracticeClass {
  id: string
  class_learner_id?: string | null
}

export interface ClassPracticeFacts {
  /** Newest evidence of any kind that the class practised — a diary clip or the cursor stamp. */
  lastPractisedAt: string | null
  /** Phrases spoken in the window: one per target2 clip under the class account. */
  phrases: number
  /** Per audio id, how many times that phrase came round in the window. */
  phraseCounts: Map<string, number>
  /**
   * When each phrase in the window was spoken, epoch ms, in diary order — so a
   * caller can split one read into weeks or days by the same timestamp rule
   * `phrases` itself uses, without a second diary read.
   */
  phraseTimes: number[]
}

export interface PhraseCount {
  known: string
  target: string
  count: number
}

/** Did this class practise at or after `since` (epoch ms)? Either signal counts. */
export function practisedSince(facts: ClassPracticeFacts | undefined, since: number): boolean {
  return !!facts?.lastPractisedAt && new Date(facts.lastPractisedAt).getTime() >= since
}

/**
 * Practice facts for every class given, keyed by CLASS id, over the last
 * `windowDays` (CLASS_PRACTICE_WINDOW_DAYS unless a caller asks for a longer
 * look-back — the org intelligence lens reads 28 days in one pass and splits
 * them by day). A class with no learner identity of its own (pre-re-anchor,
 * or never played) comes back empty rather than missing, so callers never
 * have to null-check.
 */
export async function loadClassPractice(
  svc: SupabaseClient,
  classes: ClassPracticeClass[],
  now: number = Date.now(),
  windowDays: number = CLASS_PRACTICE_WINDOW_DAYS,
): Promise<Map<string, ClassPracticeFacts>> {
  const out = new Map<string, ClassPracticeFacts>()
  for (const c of classes) out.set(c.id, { lastPractisedAt: null, phrases: 0, phraseCounts: new Map(), phraseTimes: [] })

  const classIdByLearner = new Map<string, string>()
  for (const c of classes) if (c.class_learner_id) classIdByLearner.set(c.class_learner_id, c.id)
  const learnerIds = [...classIdByLearner.keys()]
  if (learnerIds.length === 0) return out

  const sinceIso = new Date(now - windowDays * 86400000).toISOString()

  const bump = (classId: string, at: string | null | undefined) => {
    if (!at) return
    const facts = out.get(classId)!
    if (!facts.lastPractisedAt || facts.lastPractisedAt < at) facts.lastPractisedAt = at
  }

  await Promise.all([
    // The cursor stamp: bumped per cycle by every class progress save, so it
    // is the most reliable "this class practised" fact and reaches back
    // beyond the window.
    ...chunk(learnerIds).map(async (batch) => {
      const { data } = await svc
        .from('course_enrollments')
        .select('learner_id, last_practiced_at')
        .in('learner_id', batch)
      for (const r of data ?? []) {
        const classId = classIdByLearner.get((r as any).learner_id as string)
        if (!classId) continue
        bump(classId, (r as any).last_practiced_at as string | null)
      }
    }),
    // The diary: every target2 clip in the window is one phrase spoken. The
    // role filter is a JSON-path filter so only a third of the clips travel.
    ...chunk(learnerIds).map(async (batch) => {
      for (let page = 0; page < DIARY_MAX_PAGES; page++) {
        const { data } = await svc
          .from('player_events')
          .select('learner_id, occurred_at, payload')
          .in('learner_id', batch)
          .eq('event_type', 'audio_play')
          .eq('payload->>role', 'target2')
          .gte('occurred_at', sinceIso)
          .order('occurred_at', { ascending: true })
          .range(page * DIARY_PAGE, page * DIARY_PAGE + DIARY_PAGE - 1)
        const rows = data ?? []
        for (const r of rows) {
          const classId = classIdByLearner.get((r as any).learner_id as string)
          if (!classId) continue
          const facts = out.get(classId)!
          facts.phrases += 1
          const at = String((r as any).occurred_at)
          bump(classId, at)
          facts.phraseTimes.push(new Date(at).getTime())
          const audioId = audioIdFromUrl((r as any).payload?.url)
          if (audioId) facts.phraseCounts.set(audioId, (facts.phraseCounts.get(audioId) || 0) + 1)
        }
        if (rows.length < DIARY_PAGE) break
      }
    }),
  ])

  return out
}

/** `/api/audio/<uuid>` → `<uuid>`; anything else → null. */
export function audioIdFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = url.match(/\/api\/audio\/([^/?#]+)/)
  return m ? m[1] : null
}

/**
 * The phrase-by-count list: merge the per-class audio-id counts and resolve
 * each audio id to its phrase in both languages. A target2 clip belongs to
 * exactly one row of `course_practice_phrases` (build/use/component rows) or
 * of `course_legos` (the intro/debut of the LEGO itself). Sorted by count
 * desc, then alphabetically on the known side so ties are stable.
 */
export async function topPhrases(
  svc: SupabaseClient,
  facts: Iterable<ClassPracticeFacts | undefined>,
  limit: number,
): Promise<PhraseCount[]> {
  const merged = new Map<string, number>()
  for (const f of facts) {
    if (!f) continue
    for (const [audioId, n] of f.phraseCounts) merged.set(audioId, (merged.get(audioId) || 0) + n)
  }
  if (merged.size === 0) return []
  const ids = [...merged.keys()]
  const text = new Map<string, { known: string; target: string }>()
  const remember = (rows: any[] | null, overwrite: boolean) => {
    for (const r of rows ?? []) {
      const id = String(r.target2_audio_id)
      if (!overwrite && text.has(id)) continue
      text.set(id, { known: String(r.known_text ?? ''), target: String(r.target_text ?? '') })
    }
  }
  await Promise.all(
    chunk(ids).flatMap((batch) => [
      svc.from('course_practice_phrases').select('target2_audio_id, known_text, target_text').in('target2_audio_id', batch)
        .then(({ data }) => remember(data, true)),
      svc.from('course_legos').select('target2_audio_id, known_text, target_text').in('target2_audio_id', batch)
        .then(({ data }) => remember(data, false)),
    ]),
  )
  // Two audio ids can carry the same phrase text (a re-recorded clip); fold
  // them so the list reads as phrases, not as recordings.
  const byText = new Map<string, PhraseCount>()
  for (const [audioId, n] of merged) {
    const t = text.get(audioId)
    if (!t || (!t.known && !t.target)) continue
    const key = `${t.known} ${t.target}`
    const row = byText.get(key) || { known: t.known, target: t.target, count: 0 }
    row.count += n
    byText.set(key, row)
  }
  return [...byText.values()]
    .sort((a, b) => b.count - a.count || a.known.localeCompare(b.known))
    .slice(0, limit)
}

/**
 * OWN-ACCOUNT PRACTICE MINUTES in the window — staff and students' own
 * learning accounts beneath a node, off the playback ledger, i.e. the one
 * definition of a minute. Whole-class play is NOT in here and cannot be (see
 * the header): it is counted in phrases, never in minutes, until the class
 * account can write the ledger.
 *
 * People are gathered by tag: school staff (teacher/admin on SCHOOL:), group
 * members (any role on GROUP:), and class students (student on CLASS:).
 * Each learner counted once however many tags they carry.
 */
export async function ownAccountLedgerSeconds(
  svc: SupabaseClient,
  scope: { schoolIds: string[]; groupIds: string[]; classIds: string[] },
  now: number = Date.now(),
): Promise<{ seconds: number; people: number }> {
  const learnerIds = [...(await ownAccountLearners(svc, scope)).keys()]
  if (learnerIds.length === 0) return { seconds: 0, people: 0 }

  const sinceDay = new Date(now - CLASS_PRACTICE_WINDOW_DAYS * 86400000).toISOString().split('T')[0]
  let seconds = 0
  const people = new Set<string>()
  await Promise.all(
    chunk(learnerIds).map(async (batch) => {
      const { data } = await svc
        .from('learner_speaking_opportunities')
        .select('learner_id, play_seconds')
        .in('learner_id', batch)
        .gte('day', sinceDay)
      for (const r of data ?? []) {
        const s = Number((r as any).play_seconds) || 0
        if (s > 0) { seconds += s; people.add(String((r as any).learner_id)) }
      }
    }),
  )
  return { seconds, people: people.size }
}

/**
 * The PEOPLE beneath a node whose own learning accounts count as own-account
 * practice — learners.id → display name. Gathered by tag exactly as
 * ownAccountLedgerSeconds always did (school staff on SCHOOL:, group members
 * on GROUP:, students on CLASS:), plus each class's lead teacher pointer
 * (classes.teacher_user_id), so a teacher who runs a class but was never
 * tagged still counts. Each person once however many tags they carry.
 */
export async function ownAccountLearners(
  svc: SupabaseClient,
  scope: { schoolIds: string[]; groupIds: string[]; classIds: string[] },
): Promise<Map<string, string>> {
  const uids = new Set<string>()
  const tagQuery = (tagType: string, values: string[], roles: string[] | null) =>
    chunk(values).map(async (batch) => {
      let q = svc.from('user_tags').select('user_id').eq('tag_type', tagType).in('tag_value', batch).is('removed_at', null)
      if (roles) q = q.in('role_in_context', roles)
      const { data } = await q
      for (const r of data ?? []) if ((r as any).user_id) uids.add(String((r as any).user_id))
    })
  await Promise.all([
    ...tagQuery('school', scope.schoolIds.map((id) => `SCHOOL:${id}`), ['teacher', 'admin']),
    ...tagQuery('group', scope.groupIds.map((id) => `GROUP:${id}`), null),
    ...tagQuery('class', scope.classIds.map((id) => `CLASS:${id}`), ['student']),
    ...chunk(scope.classIds).map(async (batch) => {
      const { data } = await svc.from('classes').select('teacher_user_id').in('id', batch)
      for (const r of data ?? []) if ((r as any).teacher_user_id) uids.add(String((r as any).teacher_user_id))
    }),
  ])
  const out = new Map<string, string>()
  if (uids.size === 0) return out
  await Promise.all(
    chunk([...uids]).map(async (batch) => {
      const { data } = await svc.from('learners').select('id, display_name').in('user_id', batch)
      for (const r of data ?? []) if ((r as any).id) out.set(String((r as any).id), String((r as any).display_name || ''))
    }),
  )
  return out
}

/**
 * Own-account practice PER PERSON PER DAY off the playback ledger, over the
 * last `windowDays` — the same one definition of a minute, kept per person so
 * a leader can see who practised on their own account, when, and for how
 * long. learners.id → ISO day → seconds. Only days with play > 0 appear.
 */
export async function ownAccountLedgerByPerson(
  svc: SupabaseClient,
  learnerIds: string[],
  windowDays: number,
  now: number = Date.now(),
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (learnerIds.length === 0) return out
  const sinceDay = new Date(now - windowDays * 86400000).toISOString().split('T')[0]
  await Promise.all(
    chunk(learnerIds).map(async (batch) => {
      const { data } = await svc
        .from('learner_speaking_opportunities')
        .select('learner_id, day, play_seconds')
        .in('learner_id', batch)
        .gte('day', sinceDay)
      for (const r of data ?? []) {
        const s = Number((r as any).play_seconds) || 0
        if (s <= 0) continue
        const id = String((r as any).learner_id)
        const day = String((r as any).day).slice(0, 10)
        let days = out.get(id)
        if (!days) { days = new Map(); out.set(id, days) }
        days.set(day, (days.get(day) || 0) + s)
      }
    }),
  )
  return out
}
