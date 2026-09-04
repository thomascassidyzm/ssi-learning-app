/**
 * storage — the ONE place that asks the platform how much room there is.
 *
 * Why it is a seam and not just `navigator.storage.estimate()` inline: a full
 * course of offline audio does not fit in a browser. Measured 2026-09-01, a
 * full-course Offline Mode download (spa_for_eng, configured voice only) is
 * ≈1.86 GB against Safari's ~1 GB PWA limit — roughly 1.9x over, not the
 * "200x headroom" the old docs claimed. A native shell has real filesystem
 * storage and is genuinely BETTER here rather than merely different, so a
 * native backend WILL be swapped in behind this interface later.
 *
 * This module is ABSTRACTION ONLY. There is exactly one implementation today —
 * the browser one — and it behaves precisely as the inline calls it replaced,
 * including returning "unknown" rather than throwing when the API is absent.
 * No native backend is implemented here and none should be until the shell
 * exists to host it.
 */

export interface StorageEstimate {
  /** Bytes in use, or undefined when the platform will not say. */
  usageBytes?: number
  /** Bytes available in total, or undefined when the platform will not say. */
  quotaBytes?: number
}

export interface StorageBackend {
  /** Best-effort usage/quota. Never throws; returns {} when unknown. */
  estimate(): Promise<StorageEstimate>
}

/** The browser backend: IndexedDB under `navigator.storage`. */
const browserStorage: StorageBackend = {
  async estimate(): Promise<StorageEstimate> {
    try {
      if (typeof navigator === 'undefined') return {}
      const storage = (navigator as Navigator & { storage?: StorageManager }).storage
      if (!storage?.estimate) return {}
      const est = await storage.estimate()
      return { usageBytes: est.usage, quotaBytes: est.quota }
    } catch {
      return {}
    }
  },
}

let backend: StorageBackend = browserStorage

/**
 * Install a different storage backend. The native shell will call this at
 * boot once it has one; the web never does.
 */
export function setStorageBackend(next: StorageBackend): void {
  backend = next
}

/** Back to the browser backend. For tests. */
export function resetStorageBackend(): void {
  backend = browserStorage
}

/** Best-effort usage/quota from whichever backend is installed. */
export function estimateStorage(): Promise<StorageEstimate> {
  return backend.estimate()
}

/**
 * 0..1 storage pressure (usage / quota), clamped. Returns 0 when the platform
 * will not say — the same fail-soft answer the inline call gave, so a browser
 * without `navigator.storage` still downloads rather than refusing.
 */
export async function storagePressure(): Promise<number> {
  const est = await estimateStorage()
  if (!est.quotaBytes) return 0
  const ratio = (est.usageBytes ?? 0) / est.quotaBytes
  if (!Number.isFinite(ratio) || ratio < 0) return 0
  return ratio > 1 ? 1 : ratio
}
