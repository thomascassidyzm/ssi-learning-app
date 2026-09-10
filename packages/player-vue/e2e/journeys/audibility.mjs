// PURE ENERGY PREDICATE for "did the learner actually hear a word".
//
// Split out of lib.mjs so the decision can be tested without a browser: a
// function that takes samples and returns a level is worth ten screenshots.
// The instrument in lib.mjs inlines these exact functions into the page, so
// there is one implementation and it cannot drift from what is tested.
//
// Why this exists (2026-09-10): the previous check inferred audible from
// `timeupdate` with currentTime > 0.05 — that establishes playback PROGRESSED,
// which total silence passes trivially. A one-second WAV of 16,000 zero PCM
// samples was measured as lesson audio at 538.5ms. Progress is not sound.

// dBFS floor for "this is real signal, not dither or a noise floor".
// Chosen against measurement, not taste — see the report in
// tools/release-train/ and the two controls in e2e/release-audible-control.mjs.
export const AUDIBILITY = {
  floorDbfs: -45,        // RMS over one analyser window must exceed this
  minFraction: 0.20,     // ...for at least this share of elapsed play time
  minAboveFloorMs: 150,  // ...and for at least this much absolute time
  sampleIntervalMs: 20,  // analyser poll period
  maxTickMs: 100,        // a stalled tab must not credit itself unheard time
  dbMin: -120,           // reported floor; digital silence is -Infinity
}

// RMS of a time-domain block, in dBFS. All-zero samples give dbMin exactly,
// which is the honest answer for digital silence.
export function rmsDbfs(samples, dbMin) {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / (samples.length || 1))
  if (!(rms > 0)) return dbMin
  return Math.max(dbMin, 20 * Math.log10(rms))
}

export function peakDbfs(samples, dbMin) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i] < 0 ? -samples[i] : samples[i]
    if (a > peak) peak = a
  }
  if (!(peak > 0)) return dbMin
  return Math.max(dbMin, 20 * Math.log10(peak))
}

// The verdict. Two conditions, both load-bearing:
//   fraction  — energy at a single instant is a click, not a word. A clip that
//               is 90% silence with one tick at the end fails here.
//   absolute  — without it, the first two ticks of any clip are 100% of the
//               elapsed time and every clip is "audible" at 40ms.
export function audibleVerdict(m, cfg) {
  const elapsedMs = m.elapsedMs || 0
  const aboveFloorMs = m.aboveFloorMs || 0
  const fraction = elapsedMs > 0 ? aboveFloorMs / elapsedMs : 0
  return {
    fraction,
    audible: aboveFloorMs >= cfg.minAboveFloorMs && fraction >= cfg.minFraction,
  }
}
