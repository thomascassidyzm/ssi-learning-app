/**
 * usePublishedMailboxCopy — lets Tom redline the mailbox prompt's words in
 * Popty without a deploy, and never lets that get in a teacher's way.
 *
 * Same design as explainer/usePublishedExplainers.ts, and for the same
 * reasons: the repo copy is the FLOOR — it renders on the first frame and it
 * stays if anything at all goes wrong. There is no spinner, no delay and no
 * error state, because there is nothing a teacher could usefully do about any
 * of it. A 404 is the ordinary state until somebody presses Publish.
 *
 * It is a sibling rather than a generalisation of that module because that one
 * is built end to end around ExplainerSection and buildSectionsFromMarkdown —
 * a heading/blocks/figures shape. This surface is a flat handful of keyed
 * lines. Generalising would have been surgery on a working thing to save
 * thirty lines.
 *
 * The document is edited at popty.app/copy/schools-mailbox and registered in
 * ssi-dashboard-v7-clean api/lib/copy-docs.js. It follows the house shape the
 * onboarding and learner-walks surfaces already use — a human heading, the key
 * on its own line in backticks, then the words:
 *   ### What the card is called
 *   `title`
 *
 *   Can we reach you here?
 * Any key the document does not carry simply keeps its floor, and anything the
 * parser does not recognise is ignored rather than shown.
 */
import { ref } from 'vue'

const POPTY_BASE = (import.meta.env.VITE_POPTY_BASE_URL as string | undefined)?.trim()
  || 'https://popty.app'

const DOC_ID = 'schools-mailbox'

/** Short enough that a slow Popty is never something a teacher waits on. */
const TIMEOUT_MS = 2500

const published = ref<Record<string, string>>({})
let started = false

/**
 * Heading, then a backticked key on its own line, then the prose. Anything
 * else — the editor's notes to themselves, the preamble, the horizontal
 * rules — is ignored, because an editable document that only tolerates
 * machine-shaped text is not editable.
 */
export function parseMailboxCopy(markdown: string): Record<string, string> {
  const out: Record<string, string> = {}
  let key = ''
  let lines: string[] = []
  const flush = () => {
    if (key && lines.length) out[key] = lines.join(' ').trim()
    lines = []
  }
  for (const raw of markdown.split('\n')) {
    if (/^#{1,6}\s/.test(raw)) {
      flush()
      key = ''
      continue
    }
    const line = raw.trim()
    const keyLine = /^`([A-Za-z][A-Za-z0-9_]*)`$/.exec(line)
    if (keyLine) {
      flush()
      key = keyLine[1]
      continue
    }
    // The parenthetical editor notes these documents carry are context, not copy.
    if (!line || /^[*_-]{3,}$/.test(line) || (line.startsWith('*') && line.endsWith('*'))) {
      flush()
      continue
    }
    if (key) lines.push(line)
  }
  flush()
  return out
}

async function fetchPublished(): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(
      `${POPTY_BASE.replace(/\/+$/, '')}/api/copy-published?doc=${encodeURIComponent(DOC_ID)}`,
      { signal: controller.signal, credentials: 'omit' },
    )
    if (!res.ok) return
    const doc = (await res.json()) as { content?: unknown } | null
    if (!doc || typeof doc.content !== 'string' || !doc.content.trim()) return
    published.value = parseMailboxCopy(doc.content)
  } catch {
    // Aborted, offline, blocked, not JSON. The floor is already on screen.
  } finally {
    clearTimeout(timer)
  }
}

export function usePublishedMailboxCopy(): { copy: (key: string, floor: string) => string } {
  if (!started) {
    started = true
    void fetchPublished()
  }
  return {
    copy: (key: string, floor: string) => published.value[key] || floor,
  }
}

/** Test seam: forget the fetched document and let the next use try again. */
export function __resetPublishedMailboxCopy(): void {
  published.value = {}
  started = false
}
