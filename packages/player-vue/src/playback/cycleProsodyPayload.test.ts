/**
 * Pin: the cycle_prosody payload carries the PROMPT-END mark.
 *
 * `responseLatencyMs` is measured from PROMPT AUDIO START, so it silently
 * contains the known-language prompt duration — which differs per phrase.
 * Within-phrase slope is clean; any cross-phrase rolling average, deviation
 * or z-score for one learner is confounded by prompt length rather than by
 * difficulty. `promptEndMs` + `voice1StartMs` are what make the real
 * invitation-to-speak latency (speechStartMs - promptEndMs) recoverable on
 * the read side. They were recorded internally and thrown away until
 * 2026-08-20; every row written before then is permanently confounded.
 *
 * Also pinned: `responseLatencyMs` still maps to `response_latency_ms`.
 * ADDING payload keys is safe; silently REDEFINING that one would make old
 * and new rows incomparable on the field every existing consumer reads.
 *
 * This is a source-shape test because the emission lives inside a ~10k-line
 * SFC whose mount pulls the whole player; the seam is not worth the heroics.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(
  resolve(here, '../components/LearningPlayer.vue'),
  'utf8'
)

// The logEvent('cycle_prosody', { ... }) object literal, isolated so a key
// that merely appears elsewhere in the file cannot satisfy these assertions.
function prosodyPayload(): string {
  const start = src.indexOf("logEvent('cycle_prosody'")
  expect(start, "logEvent('cycle_prosody', …) not found").toBeGreaterThan(-1)
  const end = src.indexOf('\n    })', start)
  expect(end, 'cycle_prosody payload block not terminated').toBeGreaterThan(
    start
  )
  return src.slice(start, end)
}

describe('cycle_prosody payload', () => {
  const payload = prosodyPayload()

  it('persists the prompt-end mark', () => {
    expect(payload).toMatch(/promptEndMs:\s*cycleTiming\.prompt_end_ms/)
  })

  it('persists the voice1-start mark', () => {
    expect(payload).toMatch(/voice1StartMs:\s*cycleTiming\.voice1_start_ms/)
  })

  it('leaves responseLatencyMs defined exactly as it was', () => {
    expect(payload).toMatch(
      /responseLatencyMs:\s*cycleTiming\.response_latency_ms/
    )
  })

  it('stores raw marks only — no derived invitation-to-speak field', () => {
    // Deliberate: raw marks are recomputable forever, a derived field bakes
    // a definition into every historical row. Derivation lives on the read
    // side. If this ever changes it should be a deliberate ruling, not drift.
    expect(payload).not.toMatch(/invitationLatencyMs|timeToSpeakMs/)
  })
})
