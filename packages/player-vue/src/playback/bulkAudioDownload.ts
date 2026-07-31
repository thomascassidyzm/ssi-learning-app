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
 * Presigned URLs expire (server TTL, currently 300s), so URL resolution is
 * just-in-time: one chunk's URLs are requested, that chunk is downloaded to
 * completion, then the next chunk's URLs are requested — a presigned URL is
 * never held while other chunks download. If a chunk still outlives the
 * safety margin of its TTL (slow network, suspended tab), the remaining ids
 * are re-requested in one batch before dispatching, and an individual fetch
 * that fails expired-looking (403, or URL past the margin) gets exactly one
 * fresh-URL re-request before falling back to the proxy — never blind
 * retries against a dead URL.
 *
 * Strictly additive: any endpoint-level failure (not deployed yet, 5xx,
 * network error) or a denied/failed individual id falls back to the existing
 * per-clip proxy path at its original, more conservative concurrency — bulk
 * download is never worse than before this change.
 *
 * A clip that still fails after its in-pass retries is NOT final: the run
 * ends with straggler rounds — every still-missing id is re-run as a fresh
 * pass (new presigned URLs, growing wait between rounds) several times
 * before anything is counted failed. A transient tail (10 of 9,742 timing
 * out in one moment) must never conclude a download — that was the founder
 * 99.9%-then-dead-end report, 2026-07-31.
 */

export interface BatchUrlsResult {
  urls: Record<string, string>
  denied: string[]
  /** Presigned URL lifetime reported by the endpoint; absent on older deploys. */
  ttlSeconds?: number
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
  /** Clock override for tests; defaults to Date.now. */
  now?: () => number
  /** Wait override for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

export interface BulkAudioDownloadCounters {
  onDone: () => void
  onFailed: () => void
  /**
   * Entering a straggler round: the main pass is done and `remaining` clips
   * are being re-fetched with fresh URLs after a backoff. Lets the UI name
   * the phase honestly ("Finishing up — checking the last N clips") instead
   * of sitting on a near-frozen percentage.
   */
  onStragglerRound?: (remaining: number) => void
}

export interface BulkDownloadResult {
  /** False iff isCancelled() stopped the run early (mid-download toggle-off). */
  completed: boolean
  /** Ids still uncached after every straggler round; each was counted onFailed. */
  failedIds: string[]
}

const BATCH_URL_CHUNK = 500
const RETRY_ATTEMPTS = 3
const RETRY_BASE_MS = 300

// Extra whole passes over the still-missing tail before anything is counted
// failed. Each round re-requests fresh presigned URLs, so an expired-URL tail
// (long run outliving the 5-min TTL) heals here too.
const STRAGGLER_ROUNDS = 3
const STRAGGLER_BACKOFF_MS = [2_000, 8_000, 20_000]

// Past this fraction of the presigned TTL, a URL is treated as expired:
// re-request rather than burn retries on a guaranteed 403.
const TTL_SAFETY_FRACTION = 0.6
const DEFAULT_TTL_SECONDS = 300

// Direct-to-S3 pass: no serverless proxy involved, so concurrency can run
// well past the proxy's safe ceiling.
const DIRECT_CONCURRENCY_IDLE = 24
const DIRECT_CONCURRENCY_PLAYING = 6

// Fallback pass through the /api/audio proxy — unchanged from the original
// single-path loop (12 is past the point where the bottleneck is network
// latency for ~24KB clips; higher mainly raises backend throttle risk).
const PROXY_CONCURRENCY_IDLE = 12
const PROXY_CONCURRENCY_PLAYING = 4

async function withRetry(
  fn: () => Promise<void>,
  retryable: (err: unknown) => boolean = () => true,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn()
      return
    } catch (err) {
      if (!retryable(err) || attempt >= RETRY_ATTEMPTS - 1) throw err
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * (attempt + 1)))
    }
  }
}

/** AudioCache throws `AudioCache: fetch <id> → <status>` on a non-ok response. */
function looksLike403(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\b403\b/.test(message)
}

/**
 * Bulk-download `ids` into the persistent cache. `completed` is false if
 * `deps.isCancelled()` stopped the run early (caller should treat this the
 * same as the old loop's mid-download cancellation); once it's true, every id
 * has either landed (onDone) or — only after every straggler round — been
 * counted failed and reported in `failedIds` so the caller can keep retrying
 * in the background.
 */
export async function bulkDownloadAudio(
  ids: string[],
  deps: BulkAudioDownloadDeps,
  counters: BulkAudioDownloadCounters,
): Promise<BulkDownloadResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  let pending = ids
  for (let round = 0; ; round++) {
    const failed: string[] = []
    const finished = await runDownloadPass(pending, deps, counters, failed)
    if (!finished) return { completed: false, failedIds: failed }
    if (failed.length === 0) return { completed: true, failedIds: [] }
    if (round >= STRAGGLER_ROUNDS) {
      for (let k = 0; k < failed.length; k++) counters.onFailed()
      return { completed: true, failedIds: failed }
    }
    counters.onStragglerRound?.(failed.length)
    await sleep(STRAGGLER_BACKOFF_MS[Math.min(round, STRAGGLER_BACKOFF_MS.length - 1)])
    if (deps.isCancelled()) return { completed: false, failedIds: failed }
    pending = failed
  }
}

/**
 * One full pass: direct-from-S3 with JIT presigned URLs, then the per-clip
 * proxy fallback. Ids that land tick `counters.onDone()`; ids that exhaust
 * this pass's retries are pushed to `failed` (NOT counted onFailed — the
 * straggler loop above owns that). Returns false iff cancelled.
 */
async function runDownloadPass(
  ids: string[],
  deps: BulkAudioDownloadDeps,
  counters: BulkAudioDownloadCounters,
  failed: string[],
): Promise<boolean> {
  if (ids.length === 0) return true

  const now = deps.now ?? Date.now
  const proxyIds: string[] = []
  let endpointDown = false

  for (let c = 0; c < ids.length; c += BATCH_URL_CHUNK) {
    if (deps.isCancelled()) return false
    const chunk = ids.slice(c, c + BATCH_URL_CHUNK)

    if (endpointDown) {
      proxyIds.push(...chunk)
      continue
    }

    // JIT resolution: this chunk's URLs are requested only now, and the
    // chunk is downloaded to completion before the next request.
    const result = await deps.fetchBatchUrls(chunk)
    if (!result) {
      endpointDown = true
      proxyIds.push(...chunk)
      continue
    }

    const urls = new Map(Object.entries(result.urls))
    const denied = new Set(result.denied)
    const ttlMs = (result.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000
    let issuedAt = now()

    const directIds = chunk.filter((id) => urls.has(id) && !denied.has(id))
    // Denied ids fall back to ensure(), which enforces its own entitlement.
    proxyIds.push(...chunk.filter((id) => !urls.has(id) || denied.has(id)))

    let i = 0
    while (i < directIds.length) {
      if (deps.isCancelled()) return false

      // Chunk outlived its TTL safety margin (slow network, suspended tab):
      // re-request the remaining ids in one batch instead of dispatching
      // guaranteed-expired URLs.
      if (now() - issuedAt > ttlMs * TTL_SAFETY_FRACTION) {
        const remaining = directIds.slice(i)
        const refreshed = await deps.fetchBatchUrls(remaining)
        if (!refreshed) {
          proxyIds.push(...remaining)
          break
        }
        for (const [id, url] of Object.entries(refreshed.urls)) urls.set(id, url)
        for (const id of refreshed.denied) denied.add(id)
        issuedAt = now()
      }

      const conc = deps.isPlaying() ? DIRECT_CONCURRENCY_PLAYING : DIRECT_CONCURRENCY_IDLE
      const batch = directIds.slice(i, i + conc)
      i += batch.length
      const batchIssuedAt = issuedAt
      const urlExpired = (err: unknown) =>
        looksLike403(err) || now() - batchIssuedAt > ttlMs * TTL_SAFETY_FRACTION

      await Promise.all(
        batch.map(async (id) => {
          const url = urls.get(id)
          if (!url || denied.has(id)) {
            // The mid-chunk refresh dropped or denied this id.
            proxyIds.push(id)
            return
          }
          try {
            await withRetry(() => deps.ensureFromUrl(id, url), (err) => !urlExpired(err))
            counters.onDone()
            return
          } catch (err) {
            if (urlExpired(err)) {
              // Expired URL — exactly one fresh-URL re-request, never a
              // retry of the dead one.
              const fresh = await deps.fetchBatchUrls([id])
              const freshUrl = fresh?.urls[id]
              if (freshUrl && !fresh.denied.includes(id)) {
                const freshTtlMs = (fresh.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000
                const freshIssuedAt = now()
                try {
                  await withRetry(
                    () => deps.ensureFromUrl(id, freshUrl),
                    (retryErr) =>
                      !looksLike403(retryErr) &&
                      now() - freshIssuedAt <= freshTtlMs * TTL_SAFETY_FRACTION,
                  )
                  counters.onDone()
                  return
                } catch {
                  // Fresh URL failed too — proxy fallback below.
                }
              }
            }
            proxyIds.push(id)
          }
        }),
      )
    }
  }

  let i = 0
  while (i < proxyIds.length) {
    if (deps.isCancelled()) return false
    const conc = deps.isPlaying() ? PROXY_CONCURRENCY_PLAYING : PROXY_CONCURRENCY_IDLE
    const batch = proxyIds.slice(i, i + conc)
    i += batch.length
    await Promise.all(
      batch.map(async (id) => {
        try {
          await withRetry(() => deps.ensure(id))
          counters.onDone()
        } catch {
          failed.push(id)
        }
      }),
    )
  }

  return true
}

// Ceiling on one batch-urls POST. A hung request here freezes the whole run
// before a single byte downloads — null (endpoint-down → proxy fallback) is
// always better than waiting forever (founder stall, 2026-07-31).
const BATCH_URLS_TIMEOUT_MS = 20_000

/** POST /api/audio/batch-urls for one chunk of ids. Null on any failure or timeout. */
export async function fetchBatchAudioUrls(ids: string[]): Promise<BatchUrlsResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BATCH_URLS_TIMEOUT_MS)
  try {
    const res = await fetch('/api/audio/batch-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioIds: ids }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || typeof data !== 'object' || typeof data.urls !== 'object' || data.urls === null) return null
    return {
      urls: data.urls as Record<string, string>,
      denied: Array.isArray(data.denied) ? (data.denied as string[]) : [],
      ttlSeconds: typeof data.ttlSeconds === 'number' && data.ttlSeconds > 0 ? data.ttlSeconds : undefined,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
