/**
 * useReleaseNotes — read-side composable for the Settings "What's new" panel.
 *
 * TWO sources, one list:
 *  - the release train's own notes, bundled at build time (`trainReleaseNotes`),
 *    so every Friday ship reaches learners with nothing to publish by hand and
 *    nothing to fetch — available instantly, offline, signed-out;
 *  - published `release_notes` rows from Supabase, authored in
 *    views/admin/AdminReleaseNotes.vue.
 *
 * Where both describe the same ship date, the HAND-AUTHORED row wins: a human
 * who bothered to write it said it better than the generator did.
 *
 * The fetch is lazy — only fires when the caller invokes load(). Cached in a
 * module-level singleton so opening Settings multiple times in a session
 * doesn't re-hit Supabase. The SW also caches the response at the network
 * layer for offline replay.
 */
import { inject, ref, type Ref } from 'vue'
import { TRAIN_RELEASE_NOTES } from './trainReleaseNotes'

export interface ReleaseNote {
  id: string
  version: string
  released_at: string
  headline: string | null
  bullets: string[]
  is_published: boolean
}

const notes = ref<ReleaseNote[]>([...TRAIN_RELEASE_NOTES])
const isLoading = ref(false)
const error = ref<string | null>(null)
const hasLoaded = ref(false)

const DEFAULT_LIMIT = 5

/** Ship day, not timestamp — the two sources stamp the same ship differently. */
function shipDay(iso: string): string {
  return (iso || '').slice(0, 10)
}

/** Hand-authored rows win their day; everything else merges in, newest first. */
export function mergeReleaseNotes(
  authored: ReleaseNote[],
  train: ReleaseNote[],
  limit: number,
): ReleaseNote[] {
  const claimed = new Set(authored.map((n) => shipDay(n.released_at)))
  return [...authored, ...train.filter((n) => !claimed.has(shipDay(n.released_at)))]
    .sort((a, b) => b.released_at.localeCompare(a.released_at))
    .slice(0, limit)
}

export function useReleaseNotes() {
  const supabase = inject<Ref<any>>('supabase')

  async function load(limit: number = DEFAULT_LIMIT, force = false): Promise<void> {
    if (hasLoaded.value && !force) return
    // No Supabase (signed out, offline, boot order): the bundled train notes are
    // already showing — that IS the answer, not a degraded one.
    if (!supabase?.value) return
    isLoading.value = true
    error.value = null
    try {
      const { data, error: queryError } = await supabase.value
        .from('release_notes')
        .select('id, version, released_at, headline, bullets, is_published')
        .eq('is_published', true)
        .order('released_at', { ascending: false })
        .limit(limit)
      if (queryError) throw queryError
      notes.value = mergeReleaseNotes((data || []) as ReleaseNote[], TRAIN_RELEASE_NOTES, limit)
      hasLoaded.value = true
    } catch (err: any) {
      error.value = err?.message || 'Failed to load release notes'
    } finally {
      isLoading.value = false
    }
  }

  return { notes, isLoading, error, hasLoaded, load }
}
