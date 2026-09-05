/**
 * scanPlatformDoors — a pure scanner that finds platform-detection code
 * living OUTSIDE `src/platform/`.
 *
 * This is the thing that makes the seam hold after whoever built it has gone.
 * One module answers "what am I running inside"; the way that is always lost
 * is a second `if (shell === 'webview')` appearing in some component, then a
 * third, until neither platform can be reasoned about. `platformDoors.test.ts`
 * runs this over the real tree and fails on any hit.
 *
 * The scanner is a separate pure function from the test on purpose: the test
 * also feeds it SYNTHETIC content and asserts it goes RED, so the detector is
 * proven in both directions rather than only ever seen passing.
 *
 * NOTE on `isNativeScript`: that identifier exists all over this codebase and
 * means "render the target text in its own writing system" — nothing to do
 * with platforms. Every pattern below is anchored so it cannot match it.
 */

export interface DoorPattern {
  name: string
  re: RegExp
  /** Why this is a second door, shown when the test fails. */
  why: string
}

export const DOOR_PATTERNS: DoorPattern[] = [
  {
    name: 'capacitor-global',
    re: /\bCapacitor\b/,
    why: 'ask platform/capabilities, do not sniff the Capacitor global',
  },
  {
    name: 'shell-env-var',
    re: /VITE_APP_SHELL|VITE_API_ORIGIN/,
    why: 'platform/capabilities reads these once; nothing else should',
  },
  {
    name: 'injected-platform-global',
    re: /__SSI_PLATFORM__/,
    why: 'the native shell injects this for platform/capabilities alone',
  },
  {
    name: 'shell-predicate',
    re: /\bisNativeShell\b|\bisWebView\b|\bisNativePlatform\b/,
    why: 'import isNativeShell() from platform/capabilities instead of redefining it',
  },
  {
    name: 'sw-registration',
    re: /serviceWorker\s*\.\s*register\s*\(/,
    why: 'service-worker registration is gated once, in PwaUpdatePrompt, via shouldRunServiceWorker()',
  },
  {
    name: 'payment-route-redefinition',
    re: /\b(?:function|const|let|var)\s+(?:paymentRoute|canTakePayment|paddleBillingAvailable|institutionalPurchaseAvailable|storeBillingWired)\b/i,
    why: 'import the answer from platform/paymentRoute; there is exactly one payment-route declaration',
  },
  {
    name: 'raw-storage-estimate',
    re: /storage\s*\.\s*estimate\s*\(/,
    why: 'use estimateStorage()/storagePressure() from platform/storage so a native backend can be swapped in',
  },
]

export interface DoorHit {
  path: string
  line: number
  pattern: string
  why: string
  text: string
}

export interface ScanFile {
  path: string
  content: string
}

/** Lines that are obviously prose, not code, for these purposes. */
function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')
}

/**
 * Find every platform door in the supplied files. Callers exclude the seam
 * itself (and its own tests) before calling.
 */
export function findPlatformDoors(files: ScanFile[]): DoorHit[] {
  const hits: DoorHit[] = []
  for (const file of files) {
    const lines = file.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (isCommentLine(line)) continue
      for (const p of DOOR_PATTERNS) {
        if (p.re.test(line)) {
          hits.push({ path: file.path, line: i + 1, pattern: p.name, why: p.why, text: line.trim() })
        }
      }
    }
  }
  return hits
}
