/**
 * resolveIntroAudioUrl — the one precedence rule for "which clip is this
 * LEGO's introduction?".
 *
 * ORDER, highest first:
 *   1. a fully-resolved presentationAudio object on the item
 *   2. the LEGO's own presentation link (presentationAudioId → /api/audio/:id)
 *   3. a clip found by the lego_id it carries (the audioMap `intro:<legoId>`
 *      entry, built by loadIntroAudio)
 *
 * WHY THE ORDER MATTERS. A presentation clip carries the lego_id it was cut
 * for, permanently. When content repairs a LEGO by repointing it at a
 * different, already-correct clip, the superseded clip keeps that lego_id — so
 * step 3 hands back the recording that was just superseded. Greek, reported on
 * the forum 2026-08-11: 54 intros spoke their bracketed grammar label out loud
 * ("The Greek for: 'to answer (I, aorist)', is:"). course_legos was repointed
 * at 54 clean clips; every consumer that resolved by lego_id kept playing the
 * label. The link is the source of truth for WHICH clip; the lego_id on a clip
 * only records which LEGO it was cut for.
 */

export interface IntroAudioItem {
  legoId?: string | null
  /** Pre-resolved clip (the /cycles wire format supplies this). */
  presentationAudio?: { url?: string | null } | null
  /** course_legos.presentation_audio_id — what generateLearningScript emits. */
  presentationAudioId?: string | null
}

export interface ResolveIntroOptions {
  /** `intro:<legoId>` → { intro: s3Key | uuid }, as built by loadIntroAudio. */
  audioMap?: Map<string, any> | null
  /** Base for the legacy s3_key/uuid form. */
  s3BaseUrl: string
  /** Proxy base for id-addressed clips. */
  proxyEndpoint?: string
}

/** Build a playable URL from the legacy audioMap value (s3_key or bare uuid). */
const fromAudioKey = (key: string, s3BaseUrl: string): string =>
  key.includes('/') || key.endsWith('.mp3')
    ? `${s3BaseUrl}/${key}`
    : `${s3BaseUrl}/mastered/${key.toUpperCase()}.mp3`

export function resolveIntroAudioUrl(
  item: IntroAudioItem | null | undefined,
  opts: ResolveIntroOptions,
): string | null {
  if (!item) return null

  // 1. Already resolved upstream.
  if (item.presentationAudio?.url) return item.presentationAudio.url

  // 2. The LEGO's own link — the clip the player plays.
  if (item.presentationAudioId) {
    return `${opts.proxyEndpoint ?? '/api/audio'}/${item.presentationAudioId}`
  }

  // 3. Last resort: whatever clip carries this lego_id.
  if (item.legoId && opts.audioMap) {
    const key = opts.audioMap.get(`intro:${item.legoId}`)?.intro
    if (key) return fromAudioKey(key, opts.s3BaseUrl)
  }

  return null
}
