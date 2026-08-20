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
