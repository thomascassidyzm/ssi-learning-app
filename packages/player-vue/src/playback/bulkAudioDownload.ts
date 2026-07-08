/**
 * Bulk offline audio download — batch presigned S3 URLs + direct fetch.
 *
 * The bulk download loops (LearningPlayer's downloadForOffline and the INF
 * PLAY variant) can have hundreds of clips queued. Fetching each through the
 * `/api/audio/:id` serverless proxy round-trips our function per file; this
 * module resolves a batch of ids to presigned S3 GET URLs in one request
 * (`POST /api/audio/batch-urls`, cap 500 ids/request, 5-min TTL) and fetches
 * bytes directly from S3 at higher concurrency, since there's no serverless
 * cold-start/throttle risk on that path.
 *
 * Strictly additive: any endpoint-level failure (not deployed yet, 5xx,
 * network error) or a denied/failed individual id falls back to the existing
 * per-clip proxy path at its original, more conservative concurrency — bulk
 * download is never worse than before this change.
 */

export interface BatchUrlsResult {
  urls: Record<string, string>
  denied: string[]
}

export interface BulkAudioDownloadDeps {
  /** POST /api/audio/batch-urls for one chunk of ids. Null = endpoint-level failure. */
  fetchBatchUrls: (ids: string[]) => Promise<BatchUrlsResult | null>
  /** Store bytes fetched from an arbitrary (presigned) URL under `id`. */
  ensureFromUrl: (id: string, url: string) => Promise<void>
  /** Existing per-clip /api/audio proxy path — the fallback. */
  ensure: (id: string) => Promise<void>
  /** Checked before starting each batch; true stops the run early. */
  isCancelled: () => boolean
  /** Whether a learning session is currently live — lowers concurrency. */
  isPlaying: () => boolean
}

export interface BulkAudioDownloadCounters {
  onDone: () => void
  onFailed: () => void
}

const BATCH_URL_CHUNK = 500
const RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 300

// Direct-to-S3 pass: no serverless proxy involved, so concurrency can run
// well past the proxy's safe ceiling.
const DIRECT_CONCURRENCY_IDLE = 24
const DIRECT_CONCURRENCY_PLAYING = 6

// Fallback pass through the /api/audio proxy — unchanged from the original
// single-path loop (12 is past the point where the bottleneck is network
// latency for ~24KB clips; higher mainly raises backend throttle risk).
const PROXY_CONCURRENCY_IDLE = 12
const PROXY_CONCURRENCY_PLAYING = 4

async function withRetry(fn: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn()
      return
    } catch (err) {
      if (attempt >= RETRY_ATTEMPTS - 1) throw err
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)))
    }
  }
}

/**
 * Bulk-download `ids` into the persistent cache. Returns false if
 * `deps.isCancelled()` stopped the run early (caller should treat this the
 * same as the old loop's mid-download cancellation), true once every id has
 * either landed or been counted failed via `counters`.
 */
export async function bulkDownloadAudio(
  ids: string[],
  deps: BulkAudioDownloadDeps,
  counters: BulkAudioDownloadCounters,
): Promise<boolean> {
  if (ids.length === 0) return true

  const idToUrl = new Map<string, string>()
  const deniedIds = new Set<string>()
  for (let c = 0; c < ids.length; c += BATCH_URL_CHUNK) {
    if (deps.isCancelled()) return false
    const chunk = ids.slice(c, c + BATCH_URL_CHUNK)
    const result = await deps.fetchBatchUrls(chunk)
    // Endpoint-level failure — stop requesting more chunks; everything not
    // yet resolved (this chunk and any remaining) falls back to the proxy.
    if (!result) break
    for (const [id, url] of Object.entries(result.urls)) idToUrl.set(id, url)
    for (const id of result.denied) deniedIds.add(id)
  }

  const directIds = ids.filter((id) => idToUrl.has(id) && !deniedIds.has(id))
  // Denied ids fall back to ensure(), which enforces its own entitlement.
  const fallbackIds = ids.filter((id) => !idToUrl.has(id) || deniedIds.has(id))

  let i = 0
  while (i < directIds.length) {
    if (deps.isCancelled()) return false
    const conc = deps.isPlaying() ? DIRECT_CONCURRENCY_PLAYING : DIRECT_CONCURRENCY_IDLE
    const batch = directIds.slice(i, i + conc)
    i += batch.length
    await Promise.all(
      batch.map(async (id) => {
        try {
          await withRetry(() => deps.ensureFromUrl(id, idToUrl.get(id)!))
          counters.onDone()
        } catch {
          // Direct fetch failed after retries — try the proxy instead.
          fallbackIds.push(id)
        }
      }),
    )
  }

  i = 0
  while (i < fallbackIds.length) {
    if (deps.isCancelled()) return false
    const conc = deps.isPlaying() ? PROXY_CONCURRENCY_PLAYING : PROXY_CONCURRENCY_IDLE
    const batch = fallbackIds.slice(i, i + conc)
    i += batch.length
    await Promise.all(
      batch.map(async (id) => {
        try {
          await withRetry(() => deps.ensure(id))
          counters.onDone()
        } catch {
          counters.onFailed()
        }
      }),
    )
  }

  return true
}

/** POST /api/audio/batch-urls for one chunk of ids. Null on any failure. */
export async function fetchBatchAudioUrls(ids: string[]): Promise<BatchUrlsResult | null> {
  try {
    const res = await fetch('/api/audio/batch-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioIds: ids }),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || typeof data !== 'object' || typeof data.urls !== 'object' || data.urls === null) return null
    return {
      urls: data.urls as Record<string, string>,
      denied: Array.isArray(data.denied) ? (data.denied as string[]) : [],
    }
  } catch {
    return null
  }
}
