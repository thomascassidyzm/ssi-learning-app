/**
 * SHARED DEMO TELEMETRY PAYLOADS
 * ==============================
 * The VAD-fed demo payload logic, shared by every demo-data script so there is
 * exactly ONE definition of what a demo learner's telemetry looks like:
 *
 *   - generate-demo-suite.cjs   (Irish / Japanese / Welsh — full regeneration)
 *   - topup-ime-vad.cjs         (IME India world — additive top-up)
 *
 * Nothing in here invents numbers. The difficulty SERIES come from the canonical,
 * regression-tested `makeLatencySeries` in @ssi/core, and the prosody envelope is
 * produced by running the REAL `extractEnvelopeMetadata` over a synthesised
 * ~60fps energy trace — the same extractor, same field set, same
 * `extractorVersion` a live learner's mic produces.
 *
 * Every function is built off the CALLER'S seeded PRNG (`rnd`), so a caller's
 * suite stays reproducible and its draw ordering is unchanged by this extraction.
 *
 * REQUIRES @ssi/core TO BE BUILT:  pnpm --filter @ssi/core build
 */
let makeLatencySeries, extractEnvelopeMetadata, ENVELOPE_EXTRACTOR_CONSTANTS
try {
  ({ makeLatencySeries, extractEnvelopeMetadata, ENVELOPE_EXTRACTOR_CONSTANTS } = require('../../packages/core/dist/index.js'))
} catch (e) {
  console.error('✗ Could not load @ssi/core from packages/core/dist — build it first: pnpm --filter @ssi/core build')
  throw e
}

// ---------- VAD coverage (founder ruling, 2026-08-06) ----------
// "the fake demo data generator function should generate VAD data for around
// 50% of learners in schools - reflecting that not everyone in a class will
// end up getting their own account."
//
// So VAD data is a PER-LEARNER coin flip, not every-other: each class draws its
// own uptake rate around the 50% mark (some classes got more devices / more
// parental consents than others), then each learner in it flips against that
// rate. A learner WITHOUT VAD gets NO rows at all in the VAD-fed tables — no
// learner_lego_metrics, no cycle_prosody — because that is exactly how a real
// no-VAD learner presents: the write path is `recordCycle`, which only ever
// fires on a VAD latency (LearningPlayer.vue ~line 11826).
const VAD_RATE_RANGE = [0.40, 0.60]

const MASTERY_BY_ARCHETYPE = {
  struggling: ['acquisition', 'consolidating'],
  easing:     ['consolidating', 'confident'],
  steady:     ['confident', 'mastered'],
}
const DEVICE_CLASS = ['class_play', 'homework']   // demo schools = class-led + homework
const DEVICE_TYPE  = ['mobile', 'tablet', 'desktop']

/**
 * Build the telemetry payload helpers against a caller-supplied seeded PRNG.
 * @param {() => number} rnd  the caller's seeded [0,1) generator
 */
function createDemoTelemetry(rnd) {
  const pick = a => a[Math.floor(rnd() * a.length)]
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
  const uuid = () => { const h = '0123456789abcdef'; let s = ''; for (let i = 0; i < 36; i++) { if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'; else if (i === 14) s += '4'; else if (i === 19) s += h[8 + Math.floor(rnd() * 4)]; else s += h[Math.floor(rnd() * 16)] } return s }

  // This class's own VAD uptake rate — drawn once per class, flipped per learner.
  const classVadRate = () => VAD_RATE_RANGE[0] + rnd() * (VAD_RATE_RANGE[1] - VAD_RATE_RANGE[0])

  // Normalized-latency series for an archetype, driven by the caller's PRNG.
  // Do NOT re-inline the shape constants — they live in @ssi/core's
  // syntheticSeries.ts where a regression test keeps them honest.
  const difficultySeries = archetype => makeLatencySeries(archetype, { rng: rnd })

  // Synthesise the plausible rAF-rate {t, db} energy trace the live VAD hands
  // its extractor, then run the REAL extractor over it.
  function prosodyEnvelope(durationMs) {
    const syllables = Math.max(1, Math.round(durationMs / 260))
    const samples = []
    for (let t = 0; t < durationMs; t += 16) {          // ~60fps, the VAD's rAF cadence
      const lobe = Math.abs(Math.sin((t / durationMs) * syllables * Math.PI))  // one energy lobe per syllable
      const arc  = Math.sin(Math.PI * Math.min(1, t / durationMs))             // utterance-level rise/fall
      samples.push({ t, db: -58 + 34 * lobe * arc + (rnd() - 0.5) * 3 })
    }
    return extractEnvelopeMetadata(samples, durationMs)
  }

  // One cycle_prosody payload for a voiced speaking cycle on `legoId`, shaped
  // exactly like LearningPlayer.vue's logEvent('cycle_prosody', …) call.
  function prosodyPayload(legoId) {
    const learnerDurationMs = between(700, 2600)
    const target1DurationMs = between(1100, 2400)
    const env = prosodyEnvelope(learnerDurationMs)
    const responseLatencyMs = between(-350, 1400)      // negative = started during the prompt
    const speechStartMs = Math.max(0, responseLatencyMs)
    return {
      cycleId: uuid(),
      cycleType: pick(['build', 'use', 'debut', 'spaced_rep']),
      legoId,
      seedId: legoId.slice(0, 5),
      audioId: uuid(),
      responseLatencyMs,
      learnerDurationMs,
      durationDeltaMs: learnerDurationMs - target1DurationMs,
      speechStartMs,
      speechEndMs: speechStartMs + learnerDurationMs,
      startedDuringPrompt: responseLatencyMs < 0,
      stillSpeakingAtVoice1: rnd() < 0.18,
      peakEnergyDb: Math.round((-24 + rnd() * 8) * 10) / 10,
      averageEnergyDb: Math.round((-38 + rnd() * 8) * 10) / 10,
      envelope: {
        durationMs: env.durationMs,
        peakCount: env.peakCount,
        peakToMeanRatio: Math.round(env.peakToMeanRatio * 1000) / 1000,
        meanPeakWidthMs: Math.round(env.meanPeakWidthMs * 10) / 10,
        sampleCount: env.sampleCount,
        weight: Math.round(env.weight * 1000) / 1000,
        contour: env.contour ?? null,
        contourGridMs: env.contourGridMs ?? null,
      },
      extractorVersion: ENVELOPE_EXTRACTOR_CONSTANTS.version,
      playbackSpeed: 1.0,
    }
  }

  return { classVadRate, difficultySeries, prosodyEnvelope, prosodyPayload }
}

module.exports = {
  createDemoTelemetry,
  VAD_RATE_RANGE,
  MASTERY_BY_ARCHETYPE,
  DEVICE_CLASS,
  DEVICE_TYPE,
}
