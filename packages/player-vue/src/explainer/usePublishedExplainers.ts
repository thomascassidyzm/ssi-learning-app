/**
 * usePublishedExplainers — reads the How-This-Works copy live from Popty, and
 * falls back to the repo-authored prose so silently that a learner could never
 * tell which one they are reading.
 *
 * The shape of the thing:
 *   · The hardcoded HOW_THIS_WORKS_LEARNER and WHY_THIS_WORKS are the FLOOR.
 *     They are what renders on the first frame, always, and what stays on
 *     screen if the fetch fails, times out, 404s, returns something that is not
 *     JSON, or parses to nothing. There is no loading state, no spinner and no
 *     error state anywhere in this module, because there is nothing a learner
 *     could usefully do about any of it.
 *   · A 404 is the NORMAL state until somebody presses Publish in Popty. It is
 *     not logged as a fault.
 *   · The fetch runs once per page load, in the background, with a short
 *     timeout, and swaps the words in when it arrives. It never delays a render.
 *   · Figures, link urls and link titles always come from the code — see
 *     parseHtwCopy for why.
 */
import { ref, computed, type ComputedRef } from 'vue'
import {
  HOW_THIS_WORKS_LEARNER,
  WHY_THIS_WORKS,
  type ExplainerSection,
} from './learnerExplainers'
import { buildSectionsFromMarkdown } from './parseHtwCopy'

/**
 * Where the published document lives. Staging can point elsewhere by setting
 * VITE_POPTY_BASE_URL; everything else uses Popty itself.
 */
const POPTY_BASE = (import.meta.env.VITE_POPTY_BASE_URL as string | undefined)?.trim()
  || 'https://popty.app'

/** The document id Popty publishes this copy under. */
const DOC_ID = 'htw'

/** Short enough that a slow Popty is never something a learner waits on. */
const TIMEOUT_MS = 2500

interface PublishedDoc {
  id: string
  content: string
  publishedAt?: string
  publishedBy?: string
  versionId?: number
}

const published = ref<{
  howThisWorks: ExplainerSection
  whyThisWorks: ExplainerSection
} | null>(null)

let started = false

/**
 * Fetch the published document, or give up quietly. Resolves either way, and
 * never rejects — a caller that awaits it is only waiting to know the attempt
 * is over, never to find out whether it worked.
 */
async function fetchPublished(): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(
      `${POPTY_BASE.replace(/\/+$/, '')}/api/copy-published?doc=${encodeURIComponent(DOC_ID)}`,
      { signal: controller.signal, credentials: 'omit' },
    )
    // 404 means nothing has been published yet, which is ordinary, not a fault.
    if (!res.ok) return

    const doc = (await res.json()) as PublishedDoc | null
    if (!doc || typeof doc.content !== 'string' || !doc.content.trim()) return

    published.value = buildSectionsFromMarkdown(doc.content, {
      howThisWorks: HOW_THIS_WORKS_LEARNER,
      whyThisWorks: WHY_THIS_WORKS,
    })
  } catch {
    // Aborted, offline, blocked, not JSON, or the parser threw. The hardcoded
    // prose is already on screen and stays there.
  } finally {
    clearTimeout(timer)
  }
}

/** Kick the one background fetch off. Safe to call from every mount. */
export function loadPublishedExplainers(): void {
  if (started) return
  started = true
  void fetchPublished()
}

/**
 * The two sections to render: hardcoded now, published the moment it lands.
 * Both are always a complete ExplainerSection — never null, never partial.
 */
export function usePublishedExplainers(): {
  howThisWorks: ComputedRef<ExplainerSection>
  whyThisWorks: ComputedRef<ExplainerSection>
} {
  loadPublishedExplainers()
  return {
    howThisWorks: computed(() => published.value?.howThisWorks ?? HOW_THIS_WORKS_LEARNER),
    whyThisWorks: computed(() => published.value?.whyThisWorks ?? WHY_THIS_WORKS),
  }
}

/** Test seam: forget the fetched document and let the next mount try again. */
export function __resetPublishedExplainers(): void {
  published.value = null
  started = false
}
