/**
 * useReleaseNotes — read-side composable for the Settings "What's new" panel.
 *
 * Pulls the latest published release_notes rows from Supabase. Admin authoring
 * lives in views/admin/AdminReleaseNotes.vue (writes the same table directly,
 * gated by RLS).
 *
 * The fetch is lazy — only fires when the caller invokes load(). Cached in a
 * module-level singleton so opening Settings multiple times in a session
 * doesn't re-hit Supabase. The SW also caches the response at the network
 * layer for offline replay.
 */
import { inject, ref, type Ref } from 'vue'

export interface ReleaseNote {
  id: string
  version: string
  released_at: string
  headline: string | null
  bullets: string[]
  is_published: boolean
}

const notes = ref<ReleaseNote[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const hasLoaded = ref(false)

const DEFAULT_LIMIT = 5

export function useReleaseNotes() {
  const supabase = inject<Ref<any>>('supabase')

  async function load(limit: number = DEFAULT_LIMIT, force = false): Promise<void> {
    if (hasLoaded.value && !force) return
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
      notes.value = (data || []) as ReleaseNote[]
      hasLoaded.value = true
    } catch (err: any) {
      error.value = err?.message || 'Failed to load release notes'
    } finally {
      isLoading.value = false
    }
  }

  return { notes, isLoading, error, hasLoaded, load }
}
