/**
 * Playback rejection — the acceptance test for the 2026-08-20 gating fix.
 *
 * The failure it pins, measured on the live corpus: of 1433 cycle_prosody rows
 * written by the real player, 1193 (83%) had `startedDuringPrompt = true` with
 * a median `responseLatencyMs` of 32.5ms and speech "ending" ~17.5s later —
 * i.e. spanning the whole cycle. That is the VAD hearing the app's own
 * playback through the device speaker, not a learner. The timing window opens
 * at PROMPT START, so the mic is live across the entire cycle while prompt,
 * voice1 and voice2 audio play.
 *
 * These tests drive a synthetic energy timeline reproducing that signature and
 * assert it no longer yields a 32ms onset with a whole-cycle span, while a
 * genuine post-prompt utterance still yields a correct latency — and, equally
 * important, while a learner who genuinely speaks OVER the prompt is still
 * recorded as an honest early start rather than suppressed.
 *
 * `getCurrentEnergy` is stubbed at the public method. The byte-array → dB
 * mapping inside it is deliberately NOT under test here: these tests are about
 * the gating decision made on whatever number that returns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceActivityDetector } from './VoiceActivityDetector';
import type { ContinuousVADConfig, SpeechTimingResult } from './types';

// Levels on getCurrentEnergy()'s scale. Ordering is what matters, not realism:
// playback and ambient sit well above the -45 absolute threshold (which is why
// that threshold never worked), and speech sits above playback by more than
// the 9 dB margin.
const SILENCE = -100;
const AMBIENT = -25;
const PLAYBACK = -12; // app audio through the speaker — the false "learner"
const SPEECH = 0; // learner, close mic
const SPEECH_OVER_PLAYBACK = -2; // learner + playback mixture, still clears

/** Cycle shape used throughout, in ms from prompt-audio start. */
const PROMPT_END = 2000;
const VOICE_1 = 6000;
const CYCLE_END = 17500; // the live corpus's observed cycle span

type EnergyScript = (relativeMs: number) => number;

/**
 * Runs one full cycle against a synthetic energy timeline.
 * Fake timers drive rAF (the sample loop) and setTimeout (the end debounce)
 * off the same virtual clock, so the loop samples at a real ~16ms cadence.
 */
function runCycle(
  script: EnergyScript,
  config?: Partial<ContinuousVADConfig>
): SpeechTimingResult {
  const vad = new VoiceActivityDetector();

  // Minimum viable Web Audio surface — isInitialized() only checks these two.
  const analyser = { fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.8, connect: vi.fn(), disconnect: vi.fn() };
  const audioContext = { createAnalyser: vi.fn(() => analyser), createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })), state: 'running', resume: vi.fn(), close: vi.fn() };
  (vad as unknown as { audioContext: unknown }).audioContext = audioContext;
  (vad as unknown as { analyser: unknown }).analyser = analyser;

  const start = performance.now();
  vi.spyOn(vad, 'getCurrentEnergy').mockImplementation(() =>
    script(performance.now() - start)
  );

  vad.startContinuousMonitoring(config);

  // Advance in 16ms steps, marking phases as their moments pass.
  let marked = { promptEnd: false, pause: false, voice1: false };
  for (let t = 0; t < CYCLE_END; t += 16) {
    vi.advanceTimersByTime(16);
    const rel = performance.now() - start;
    if (!marked.promptEnd && rel >= PROMPT_END) {
      vad.markPhaseTransition('PROMPT_END');
      vad.markPhaseTransition('PAUSE');
      marked = { ...marked, promptEnd: true, pause: true };
    }
    if (!marked.voice1 && rel >= VOICE_1) {
      vad.markPhaseTransition('VOICE_1');
      marked = { ...marked, voice1: true };
    }
  }

  return vad.stopContinuousMonitoring(2000);
}

describe('VAD playback rejection', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'],
    });
    // @ssi/core tests run in node, which has no rAF at all. Drive it off the
    // same faked setTimeout at a ~16ms display cadence, so the sample loop and
    // the end-debounce share one virtual clock.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects the live failure signature: app audio from 30ms, whole cycle', () => {
    // Exactly what the 1193 bad rows look like — energy comfortably above the
    // old -45 absolute threshold from 30ms in, never dropping, to cycle end.
    const result = runCycle((t) => (t < 30 ? SILENCE : PLAYBACK));

    expect(result.speech_detected).toBe(false);
    expect(result.speech_start_ms).toBeNull();
    expect(result.response_latency_ms).toBeNull();
    expect(result.started_during_prompt).toBe(false);
  });

  it('still measures a genuine utterance after the prompt', () => {
    // Prompt audio, then the learner answers at 3000ms for 1500ms.
    const result = runCycle((t) => {
      if (t < PROMPT_END) return PLAYBACK;
      if (t >= 3000 && t < 4500) return SPEECH;
      if (t >= VOICE_1) return PLAYBACK;
      return AMBIENT;
    });

    expect(result.speech_detected).toBe(true);
    expect(result.response_latency_ms).toBeGreaterThan(2900);
    expect(result.response_latency_ms).toBeLessThan(3200);
    expect(result.started_during_prompt).toBe(false);
    expect(result.learner_duration_ms).toBeGreaterThan(1300);
    expect(result.learner_duration_ms).toBeLessThan(1900);
  });

  it('keeps a genuine early start honest rather than suppressing it', () => {
    // A confident learner speaking OVER the prompt is real and interesting.
    // Their voice ADDS to playback, so the mixture clears the margin.
    const result = runCycle((t) => {
      if (t >= 900 && t < 2400) return SPEECH_OVER_PLAYBACK;
      if (t < PROMPT_END) return PLAYBACK;
      if (t >= VOICE_1) return PLAYBACK;
      return AMBIENT;
    });

    expect(result.speech_detected).toBe(true);
    expect(result.started_during_prompt).toBe(true);
    expect(result.response_latency_ms).toBeGreaterThan(850);
    expect(result.response_latency_ms).toBeLessThan(1100);
  });

  it('clamps a never-ending utterance instead of spanning the whole cycle', () => {
    // Learner starts at 3000 and the mic never drops below the floor again
    // (loud room, or target audio at learner level). Unclamped, this is the
    // 17.5-second "utterance" the corpus is full of.
    const result = runCycle((t) => (t < PROMPT_END ? PLAYBACK : t >= 3000 ? SPEECH : AMBIENT));

    expect(result.speech_detected).toBe(true);
    expect(result.speech_end_ms).not.toBeNull();
    expect(result.speech_end_ms!).toBeLessThanOrEqual(VOICE_1 + 1500 + 32);
    expect(result.learner_duration_ms!).toBeLessThan(CYCLE_END - 3000);
    // The overlap signal itself must survive the clamp — it is real evidence.
    expect(result.still_speaking_at_voice1).toBe(true);
  });

  it('discards a brief transient and re-arms for the real utterance', () => {
    // A door, a tap, a click: ~48ms above the floor. The old code let the
    // first thing to clear the threshold own the whole measurement forever.
    const result = runCycle((t) => {
      if (t < PROMPT_END) return PLAYBACK;
      if (t >= 2500 && t < 2548) return SPEECH;
      if (t >= 4000 && t < 5500) return SPEECH;
      if (t >= VOICE_1) return PLAYBACK;
      return AMBIENT;
    });

    expect(result.speech_detected).toBe(true);
    expect(result.response_latency_ms).toBeGreaterThan(3900);
    expect(result.response_latency_ms).toBeLessThan(4200);
  });

  it('does not open a new utterance once VOICE_1 is playing', () => {
    // Nothing from the learner; target audio starts at VOICE_1. There is no
    // invitation to speak left, and any latency measured here is meaningless.
    const result = runCycle((t) => {
      if (t < PROMPT_END) return PLAYBACK;
      if (t >= VOICE_1) return SPEECH;
      return AMBIENT;
    });

    expect(result.speech_detected).toBe(false);
  });

  it('honours a per-call threshold — continuousConfig now reaches the gate', () => {
    // Regression: the loop read this.config for the threshold and min_frames
    // while reading continuousConfig only for the debounce, so a threshold
    // passed to startContinuousMonitoring was silently ignored.
    const result = runCycle(
      (t) => (t < PROMPT_END ? PLAYBACK : t >= 3000 && t < 4500 ? SPEECH : AMBIENT),
      { adaptive_floor_enabled: false, energy_threshold_db: 20 }
    );

    expect(result.speech_detected).toBe(false);
  });

  it('falls back to the absolute threshold when calibration is starved — and that fallback IS the old bug', () => {
    // Two jobs. (1) Document the fallback: rAF throttled / tab backgrounded
    // means too few calibration samples to trust a measured floor, and the
    // absolute threshold governs rather than a floor built on noise.
    // (2) Serve as this suite's differential control. Same energy script as
    // the "genuine utterance" test above, floor disabled — if the assertions
    // below stop holding, the scripts no longer reproduce the failure and the
    // passing tests above prove nothing.
    const result = runCycle(
      (t) => (t < PROMPT_END ? PLAYBACK : t >= 3000 && t < 4500 ? SPEECH : AMBIENT),
      { calibration_min_samples: 10_000 }
    );

    // Playback clears -45, owns the onset, and the real utterance at 3000ms is
    // never seen: the live corpus's exact signature. The onset lands just
    // after the calibration slice rather than at 32ms, because the slice
    // itself blocks onsets even when its result is later discarded — so this
    // fallback is strictly less wrong than the old code, not identical to it.
    expect(result.speech_detected).toBe(true);
    expect(result.started_during_prompt).toBe(true);
    expect(result.response_latency_ms!).toBeLessThan(1000);
  });
});

/**
 * Early speech is DATA, not noise (Tom, 2026-08-20).
 *
 * "We do want the latency measure to start timing from the beginning of the
 * prompt, not the end of it, we want to capture the fact that confident
 * speakers often start speaking before the whole prompt has finished."
 *
 * So the gate has two jobs at once, and a change that wins either by losing
 * the other is not a fix: reject the app's own playback, AND keep a learner
 * who speaks over the prompt — with an HONEST latency, measured from prompt
 * -audio start, flagged started_during_prompt.
 *
 * The zero point does not move. `response_latency_ms` stays measured from
 * prompt start; `prompt_end_ms` is stored so the read side can compute a
 * signed offset, negative for a genuine early speaker.
 */
describe('VAD early speech is kept, and kept honest', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'],
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The most confident speaker there is: answers 200ms in, already knew it. */
  const veryEarlySpeaker: EnergyScript = (t) => {
    if (t >= 200 && t < 2600) return SPEECH_OVER_PLAYBACK;
    if (t < PROMPT_END) return PLAYBACK;
    if (t >= VOICE_1) return PLAYBACK;
    return AMBIENT;
  };

  it('credits an onset INSIDE the calibration window to when it really began', () => {
    // The calibration slice (0-400ms) cannot judge its own samples as they
    // arrive — there is no floor yet. Before the back-date, this learner was
    // credited at the moment the slice happened to close (measured: 432ms for
    // a 200ms onset) and that inflated latency was reported as truth.
    const result = runCycle(veryEarlySpeaker);

    expect(result.speech_detected).toBe(true);
    expect(result.started_during_prompt).toBe(true);
    // Within a couple of 16ms frames of the true 200ms onset, and well clear
    // of the 400ms calibration boundary that used to swallow it.
    expect(result.response_latency_ms!).toBeGreaterThan(150);
    expect(result.response_latency_ms!).toBeLessThan(300);
  });

  it('signed offset from prompt end is negative for that early speaker', () => {
    // The read side computes speech_start - prompt_end. Tom's ruling keeps the
    // zero point at prompt START, so this negative value is the thing that
    // carries "they beat the prompt", and it has to be derivable here.
    const result = runCycle(veryEarlySpeaker);

    expect(result.prompt_end_ms).toBeGreaterThan(0);
    expect(result.speech_start_ms! - result.prompt_end_ms).toBeLessThan(0);
    // ...and the zero point really is prompt start, not prompt end.
    expect(result.response_latency_ms).toBe(result.speech_start_ms);
  });

  /** Learner talking from 150ms: ~64% of the 400ms slice is their own voice. */
  const contaminatingSpeaker: EnergyScript = (t) => {
    if (t >= 150 && t < 2600) return SPEECH_OVER_PLAYBACK;
    if (t < PROMPT_END) return PLAYBACK;
    if (t >= VOICE_1) return PLAYBACK;
    return AMBIENT;
  };

  it('survives the learner contaminating the floor with their own voice', () => {
    const result = runCycle(contaminatingSpeaker);

    expect(result.speech_detected).toBe(true);
    expect(result.started_during_prompt).toBe(true);
    expect(result.response_latency_ms!).toBeLessThan(300);
  });

  it('DIFFERENTIAL: the median floor loses that learner entirely', () => {
    // Control for the test above — it is the lower-quartile floor doing the
    // work, not the scripts being easy. Speech is ADDITIVE, so contamination
    // is one-directional; with >50% of the slice covered the median lands on
    // the learner's own voice, the floor rises above them, and the whole
    // utterance is discarded. If this ever starts passing, the script no
    // longer reproduces the failure and the test above proves nothing.
    const result = runCycle(contaminatingSpeaker, { calibration_percentile: 0.5 });

    expect(result.speech_detected).toBe(false);
  });

  /** Prompt audio with a quiet head and a louder body — floor measured on the
   *  head, so the body clears the margin on its own. No learner present. */
  const rampingPrompt: EnergyScript = (t) => {
    if (t < 400) return -30;
    if (t < PROMPT_END) return -12;
    if (t >= VOICE_1) return -12;
    return AMBIENT;
  };

  it('rejects prompt bleed that clears the margin but dies with the prompt', () => {
    // The energy margin alone does NOT cover this: measured, it recorded a
    // learner "responding" at ~430ms with nobody in the room. What separates
    // them is the boundary, because bleed IS the prompt audio — it stops when
    // the prompt stops.
    const result = runCycle(rampingPrompt);

    expect(result.speech_detected).toBe(false);
    expect(result.speech_start_ms).toBeNull();
    expect(result.started_during_prompt).toBe(false);
    // An end with no start must not reach the read side either.
    expect(result.speech_end_ms).toBeNull();
  });

  it('DIFFERENTIAL: without the boundary test that bleed is recorded as a learner', () => {
    // Control for the test above. guard=0 disables the boundary test, leaving
    // the energy margin alone — and the margin passes this bleed.
    const result = runCycle(rampingPrompt, { prompt_boundary_guard_ms: 0 });

    expect(result.speech_detected).toBe(true);
    expect(result.started_during_prompt).toBe(true);
    expect(result.response_latency_ms!).toBeLessThan(600);
  });

  /** The same ramping prompt, with a real answer at 3000ms behind it. */
  const rampingPromptThenLearner: EnergyScript = (t) => {
    if (t < 400) return -30;
    if (t < PROMPT_END) return -12;
    if (t >= 3000 && t < 4500) return SPEECH;
    if (t >= VOICE_1) return -12;
    return AMBIENT;
  };

  it('re-arms after rejecting bleed, so the real answer keeps its own latency', () => {
    const result = runCycle(rampingPromptThenLearner);

    expect(result.speech_detected).toBe(true);
    expect(result.started_during_prompt).toBe(false);
    expect(result.response_latency_ms!).toBeGreaterThan(2900);
    expect(result.response_latency_ms!).toBeLessThan(3200);
  });

  it('DIFFERENTIAL: without the boundary test the bleed steals that latency', () => {
    const result = runCycle(rampingPromptThenLearner, { prompt_boundary_guard_ms: 0 });

    // ~430ms reported for an answer actually given at 3000ms.
    expect(result.response_latency_ms!).toBeLessThan(600);
  });

  it('keeps a SHORT early answer that finishes before the prompt does', () => {
    // The case a naive "must continue past prompt end" rule would destroy: a
    // one-word answer over the prompt, done at 1400ms with 600ms of prompt
    // still to play. Falling back to the floor WHILE the prompt is still
    // audibly playing proves it is not the prompt, so it is kept — the
    // boundary test cuts only the runs that die WITH the prompt.
    const result = runCycle((t) => {
      if (t >= 900 && t < 1400) return SPEECH_OVER_PLAYBACK;
      if (t < PROMPT_END) return PLAYBACK;
      if (t >= VOICE_1) return PLAYBACK;
      return AMBIENT;
    });

    expect(result.speech_detected).toBe(true);
    expect(result.started_during_prompt).toBe(true);
    expect(result.response_latency_ms!).toBeGreaterThan(850);
    expect(result.response_latency_ms!).toBeLessThan(1050);
    // It must keep its END too — the verdict lands after the run is over, so
    // confirming the onset must not wipe the end that run already recorded.
    expect(result.speech_end_ms).not.toBeNull();
    expect(result.speech_end_ms!).toBeGreaterThan(1350);
    expect(result.speech_end_ms!).toBeLessThan(1500);
    expect(result.learner_duration_ms!).toBeGreaterThan(400);
  });

  it('a transient over the prompt is still discarded, and still re-arms', () => {
    // Holding prompt-window candidates open must not resurrect the transient
    // bug: a ~48ms click at 1000ms is not an early answer.
    const result = runCycle((t) => {
      if (t >= 1000 && t < 1048) return SPEECH_OVER_PLAYBACK;
      if (t < PROMPT_END) return PLAYBACK;
      if (t >= 3000 && t < 4500) return SPEECH;
      if (t >= VOICE_1) return PLAYBACK;
      return AMBIENT;
    });

    expect(result.speech_detected).toBe(true);
    expect(result.started_during_prompt).toBe(false);
    expect(result.response_latency_ms!).toBeGreaterThan(2900);
    expect(result.response_latency_ms!).toBeLessThan(3200);
  });
});
