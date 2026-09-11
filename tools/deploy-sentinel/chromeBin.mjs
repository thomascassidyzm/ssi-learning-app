// chromeBin — where is the headless Chromium the play probe drives?
//
// Why this is a module and not three strings (2026-09-11, job #228): the
// sentinel used to look for exactly `chromium-1234`, `chromium-1228` and
// `chromium-1208` under ~/.cache/ms-playwright. A routine @playwright/test
// bump (1.58.2, 2026-09-10) replaced those with `chromium-1243`, the lookup
// found nothing, and the sentinel ran its volume leg WITHOUT the browser
// play-through that is the only thing standing between "a quiet hour" and a
// page to Tom. It paged him at 13:12 on a healthy production. The play probe
// had silently stopped running the previous afternoon.
//
// So: scan the cache for every `chromium-<build>` directory, newest build
// first, and take the first whose binary exists. A playwright upgrade can no
// longer switch the probe off.
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const safeList = (dir) => { try { return readdirSync(dir) } catch { return [] } }

/** Candidate chrome binaries under a playwright cache dir, newest build first. */
export function chromeCandidates(pwDir, list = safeList) {
  return list(pwDir)
    .map((d) => d.match(/^chromium-(\d+)$/))
    .filter(Boolean)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map((m) => join(pwDir, m[0], 'chrome-linux64/chrome'))
}

/** The chrome binary to run, or undefined when none is installed. */
export function findChrome(pwDir, { list = safeList, exists = existsSync } = {}) {
  return chromeCandidates(pwDir, list).find((p) => exists(p))
}
