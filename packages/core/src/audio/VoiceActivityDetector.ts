/**
 * VoiceActivityDetector - Real-time voice activity detection using Web Audio API
 *
 * Detects when the learner is speaking by monitoring microphone input energy levels.
 * Browser-only, no server storage.
 *
 * Two modes of operation:
 *
 * 1. PAUSE-only monitoring (legacy):
 *    vad.startMonitoring();   // Call at PAUSE start
 *    vad.stopMonitoring();    // Call at PAUSE end → VADResult
 *
 * 2. Continuous monitoring (new - for timing analysis):
 *    vad.startContinuousMonitoring();           // Call at PROMPT start
 *    vad.markPhaseTransition('PROMPT_END', t);  // Record phase boundaries
 *    vad.markPhaseTransition('VOICE_1', t);
 *    const result = vad.stopContinuousMonitoring(modelDuration);  // → SpeechTimingResult
 */

import type {
  VADConfig,
  VADResult,
  VADStatus,
  TimingPhase,
  SpeechTimingResult,
  ContinuousVADConfig,
} from './types';
import { DEFAULT_VAD_CONFIG } from '../config/defaults';
import { DEFAULT_CONTINUOUS_VAD_CONFIG, createEmptySpeechTimingResult } from './types';
import { extractEnvelopeMetadata, type TimedEnergySample } from './envelopeMetadata';

export class VoiceActivityDetector {
  private config: VADConfig;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  // Monitoring state
  private isMonitoring = false;
  private monitoringStartTime = 0;
  private rafId: number | null = null;

  // Accumulated metrics during monitoring
  private energySamples: number[] = [];
  private speechFrameCount = 0;
  private consecutiveAboveThreshold = 0;
  private peakEnergy = -Infinity;
  private totalSpeechDuration = 0;
  private lastSpeechStartTime: number | null = null;

  // Continuous monitoring state (for timing analysis)
  private isContinuousMode = false;
  private continuousConfig: ContinuousVADConfig = DEFAULT_CONTINUOUS_VAD_CONFIG;
  private continuousStartTime = 0;
  private phaseTimestamps: Map<string, number> = new Map();
  private firstSpeechStartAbsolute: number | null = null;  // Absolute time of first speech start
  private lastSpeechEndAbsolute: number | null = null;     // Absolute time of last speech end
  private speechEndDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmedSpeechEnd: number | null = null;        // Confirmed end (after debounce)

  // Timestamped energy samples for continuous mode ONLY (adaptation v2 WP-6).
  // rAF cadence is display-locked/throttle-prone, so envelope extraction needs
  // timestamps, not just values. Never leaves this class — stopContinuousMonitoring
  // consumes it into EnvelopeMetadata (5 numbers) and discards it immediately.
  private continuousEnergyTimeline: TimedEnergySample[] = [];

  // Playback-rejection state (continuous mode only, 2026-08-20).
  // See ContinuousVADConfig for why the gate has to be relative.
  private calibrationSamples: number[] = [];
  private calibrationClosed = false;
  /** max(absolute threshold, measured floor + margin); null until calibrated */
  private adaptiveThresholdDb: number | null = null;
  /** Start of an above-floor burst not yet sustained long enough to count.
   *  Re-armable: a burst that dies before min_speech_duration_ms is discarded,
   *  so a transient can no longer own the whole cycle's measurement. */
  private candidateSpeechStart: number | null = null;
  /** Has the pending candidate stayed up for min_speech_duration_ms? Once it
   *  has, it is held until the prompt-end boundary can judge it, rather than
   *  being dropped the moment its run ends. */
  private candidateSustained = false;
  /** Absolute time the pending candidate's run fell back to the floor; null
   *  while it is still above. A prompt-window candidate is judged on WHERE
   *  its run ended relative to PROMPT_END, and PROMPT_END is usually marked
   *  after the run has already ended, so that moment has to be remembered. */
  private candidateRunEnd: number | null = null;

  constructor(config: Partial<VADConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  /**
   * Initialize VAD with microphone access
   * MUST be called from a user gesture (click, touch, etc.)
   * @returns true if initialization successful, false otherwise
   */
  async initialize(): Promise<boolean> {
    // Check browser support
    if (typeof window === 'undefined') {
      console.warn('VoiceActivityDetector: Not in browser environment');
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn('VoiceActivityDetector: getUserMedia not supported');
      return false;
    }

    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      // Create audio context
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioContextClass();

      // Create analyser node
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.fft_size;
      this.analyser.smoothingTimeConstant = this.config.smoothing;

      // Connect microphone to analyser
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.analyser);
      // Note: We don't connect to destination (speakers) - we're just analyzing

      return true;
    } catch (error) {
      console.warn('VoiceActivityDetector: Failed to initialize', error);
      this.dispose();
      return false;
    }
  }

  /**
   * Check if VAD is initialized and ready
   */
  isInitialized(): boolean {
    return this.audioContext !== null && this.analyser !== null;
  }

  /**
   * Start monitoring for voice activity
   * Call this at the beginning of PAUSE phase
   */
  startMonitoring(): void {
    if (!this.isInitialized()) {
      console.warn('VoiceActivityDetector: Not initialized, call initialize() first');
      return;
    }

    // Reset monitoring state
    this.isMonitoring = true;
    this.monitoringStartTime = performance.now();
    this.energySamples = [];
    this.speechFrameCount = 0;
    this.consecutiveAboveThreshold = 0;
    this.peakEnergy = -Infinity;
    this.totalSpeechDuration = 0;
    this.lastSpeechStartTime = null;

    // Resume audio context if suspended (required on iOS)
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }

    // Start the analysis loop
    this.analyzeLoop();
  }

  /**
   * Stop monitoring and return results
   * Call this at the end of PAUSE phase
   */
  stopMonitoring(): VADResult {
    const endTime = performance.now();
    this.isMonitoring = false;

    // Cancel animation frame
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Finalize speech duration if still speaking
    if (this.lastSpeechStartTime !== null) {
      this.totalSpeechDuration += endTime - this.lastSpeechStartTime;
    }

    const duration = endTime - this.monitoringStartTime;
    const averageEnergy = this.calculateAverageEnergy();
    const activityRatio = duration > 0 ? this.totalSpeechDuration / duration : 0;

    return {
      speech_detected: this.speechFrameCount > 0,
      speech_duration_ms: this.totalSpeechDuration,
      peak_energy_db: this.peakEnergy === -Infinity ? -100 : this.peakEnergy,
      average_energy_db: averageEnergy,
      activity_ratio: Math.min(1, activityRatio),
      start_time: this.monitoringStartTime,
      end_time: endTime,
    };
  }

  /**
   * Get current VAD status for UI feedback
   */
  getStatus(): VADStatus {
    if (!this.isMonitoring || !this.analyser) {
      return {
        is_speaking: false,
        current_energy_db: -100,
        is_active: this.isMonitoring,
      };
    }

    const energy = this.getCurrentEnergy();
    const isSpeaking = energy > this.config.energy_threshold_db;

    return {
      is_speaking: isSpeaking,
      current_energy_db: energy,
      is_active: true,
    };
  }

  /**
   * Get current energy level in dB
   */
  getCurrentEnergy(): number {
    if (!this.analyser) return -100;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    // Calculate RMS energy
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      // Convert from 0-255 to 0-1 range
      const normalized = dataArray[i] / 255;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Convert to dB (avoid log(0))
    const db = rms > 0 ? 20 * Math.log10(rms) : -100;
    return db;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VADConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.analyser) {
      if (config.fft_size !== undefined) {
        this.analyser.fftSize = config.fft_size;
      }
      if (config.smoothing !== undefined) {
        this.analyser.smoothingTimeConstant = config.smoothing;
      }
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.isMonitoring = false;
    this.isContinuousMode = false;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.speechEndDebounceTimer) {
      clearTimeout(this.speechEndDebounceTimer);
      this.speechEndDebounceTimer = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  /**
   * Internal analysis loop using requestAnimationFrame
   */
  private analyzeLoop(): void {
    if (!this.isMonitoring || !this.analyser) return;

    const energy = this.getCurrentEnergy();
    const now = performance.now();

    // Record energy sample
    this.energySamples.push(energy);

    // Track peak
    if (energy > this.peakEnergy) {
      this.peakEnergy = energy;
    }

    // Check against threshold
    const isAboveThreshold = energy > this.config.energy_threshold_db;

    if (isAboveThreshold) {
      this.consecutiveAboveThreshold++;

      // Confirm speech after min_frames_above consecutive frames
      if (this.consecutiveAboveThreshold >= this.config.min_frames_above) {
        if (this.lastSpeechStartTime === null) {
          // Speech just started
          this.lastSpeechStartTime = now;
        }
        this.speechFrameCount++;
      }
    } else {
      // Below threshold
      if (this.lastSpeechStartTime !== null) {
        // Speech just ended
        this.totalSpeechDuration += now - this.lastSpeechStartTime;
        this.lastSpeechStartTime = null;
      }
      this.consecutiveAboveThreshold = 0;
    }

    // Continue loop
    this.rafId = requestAnimationFrame(() => this.analyzeLoop());
  }

  /**
   * Calculate average energy from samples
   */
  private calculateAverageEnergy(): number {
    if (this.energySamples.length === 0) return -100;

    const sum = this.energySamples.reduce((a, b) => a + b, 0);
    return sum / this.energySamples.length;
  }

  // ============================================
  // CONTINUOUS MONITORING (for timing analysis)
  // ============================================

  /**
   * Start continuous monitoring from PROMPT phase.
   * Call this at the beginning of the PROMPT phase.
   *
   * @param config Optional continuous monitoring config
   */
  startContinuousMonitoring(config?: Partial<ContinuousVADConfig>): void {
    if (!this.isInitialized()) {
      console.warn('VoiceActivityDetector: Not initialized, call initialize() first');
      return;
    }

    // Set up continuous mode
    this.isContinuousMode = true;
    this.continuousConfig = { ...DEFAULT_CONTINUOUS_VAD_CONFIG, ...this.config, ...config };
    this.continuousStartTime = performance.now();

    // Reset continuous monitoring state
    this.phaseTimestamps.clear();
    this.phaseTimestamps.set('PROMPT', 0); // Prompt starts at time 0 (relative)
    this.firstSpeechStartAbsolute = null;
    this.lastSpeechEndAbsolute = null;
    this.confirmedSpeechEnd = null;
    this.continuousEnergyTimeline = [];
    this.calibrationSamples = [];
    this.calibrationClosed = false;
    this.adaptiveThresholdDb = null;
    this.candidateSpeechStart = null;
    this.candidateSustained = false;
    this.candidateRunEnd = null;
    if (this.speechEndDebounceTimer) {
      clearTimeout(this.speechEndDebounceTimer);
      this.speechEndDebounceTimer = null;
    }

    // Reset standard monitoring state too
    this.isMonitoring = true;
    this.monitoringStartTime = this.continuousStartTime;
    this.energySamples = [];
    this.speechFrameCount = 0;
    this.consecutiveAboveThreshold = 0;
    this.peakEnergy = -Infinity;
    this.totalSpeechDuration = 0;
    this.lastSpeechStartTime = null;

    // Resume audio context if suspended (required on iOS)
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }

    // Start the analysis loop
    this.continuousAnalyzeLoop();
  }

  /**
   * Mark a phase transition during continuous monitoring.
   * Use this to record when phases start/end for overlap detection.
   *
   * @param phase The phase that is starting or a marker like 'PROMPT_END'
   * @param timestamp Optional absolute timestamp (defaults to now)
   */
  markPhaseTransition(phase: TimingPhase | 'PROMPT_END', timestamp?: number): void {
    if (!this.isContinuousMode) {
      console.warn('VoiceActivityDetector: Not in continuous mode');
      return;
    }

    const absoluteTime = timestamp ?? performance.now();
    const relativeTime = absoluteTime - this.continuousStartTime;
    this.phaseTimestamps.set(phase, relativeTime);
  }

  /**
   * Check if currently in continuous monitoring mode
   */
  isContinuousMonitoring(): boolean {
    return this.isContinuousMode;
  }

  /**
   * Stop continuous monitoring and return timing results.
   *
   * @param modelDurationMs Duration of the model (target) audio in ms
   * @returns Full timing result with latency, duration delta, and overlap flags
   */
  stopContinuousMonitoring(modelDurationMs: number): SpeechTimingResult {
    if (!this.isContinuousMode) {
      console.warn('VoiceActivityDetector: Not in continuous mode');
      return createEmptySpeechTimingResult(0, 0);
    }

    const endTime = performance.now();
    this.isMonitoring = false;
    this.isContinuousMode = false;

    // Cancel animation frame
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Cancel debounce timer
    if (this.speechEndDebounceTimer) {
      clearTimeout(this.speechEndDebounceTimer);
      this.speechEndDebounceTimer = null;
    }

    // Get phase timestamps (relative to prompt start)
    const promptEndMs = this.phaseTimestamps.get('PROMPT_END') ?? 0;
    const voice1StartMs = this.phaseTimestamps.get('VOICE_1') ?? 0;

    // Last chance for a candidate still awaiting the prompt-end boundary —
    // e.g. an utterance that was still running when the cycle ended, or a
    // cycle where PROMPT_END was never marked at all.
    this.tryResolveCandidate(endTime - this.continuousStartTime, true);

    // Finalize speech end if still speaking. Clamped to shortly after VOICE_1:
    // past that the app's own target audio is the likelier source of whatever
    // is still above the floor, and an unclamped end here is precisely what
    // produced the whole-cycle ~17.5s "utterances" in the live corpus.
    if (this.lastSpeechStartTime !== null && this.confirmedSpeechEnd === null) {
      const cycleEndMs = endTime - this.continuousStartTime;
      const hasVoice1 = this.phaseTimestamps.has('VOICE_1');
      this.confirmedSpeechEnd = hasVoice1
        ? Math.min(cycleEndMs, voice1StartMs + this.continuousConfig.post_voice1_grace_ms)
        : cycleEndMs;
    }

    // Calculate speech timestamps (relative to prompt start)
    const speechStartMs = this.firstSpeechStartAbsolute !== null
      ? this.firstSpeechStartAbsolute - this.continuousStartTime
      : null;
    // An end with no start is not a result the read side should have to cope
    // with. It arises when the only above-floor run was rejected as the app's
    // own prompt audio: the run's end was recorded before the verdict landed.
    const speechEndMs = speechStartMs === null ? null : (
      this.confirmedSpeechEnd ?? (
        this.lastSpeechEndAbsolute !== null
          ? this.lastSpeechEndAbsolute - this.continuousStartTime
          : null
      )
    );

    // Calculate derived metrics
    const responseLatencyMs = speechStartMs;
    const learnerDurationMs = (speechStartMs !== null && speechEndMs !== null)
      ? speechEndMs - speechStartMs
      : null;
    const durationDeltaMs = learnerDurationMs !== null
      ? learnerDurationMs - modelDurationMs
      : null;

    // Calculate overlap flags
    const startedDuringPrompt = speechStartMs !== null && speechStartMs < promptEndMs;
    const stillSpeakingAtVoice1 = speechEndMs !== null && speechEndMs > voice1StartMs;

    // Calculate energy stats
    const averageEnergy = this.calculateAverageEnergy();

    // Volume-envelope metadata (adaptation v2 WP-6, §5.1): only within the
    // confirmed speech window, and only the derived numbers — the timeline
    // is consumed and discarded right here, never exposed on the result.
    let envelope;
    if (speechStartMs !== null && speechEndMs !== null && learnerDurationMs !== null) {
      const speechWindow = this.continuousEnergyTimeline.filter(
        (s) => s.t - this.continuousStartTime >= speechStartMs && s.t - this.continuousStartTime <= speechEndMs
      );
      envelope = extractEnvelopeMetadata(speechWindow, learnerDurationMs);
    }
    this.continuousEnergyTimeline = [];

    return {
      prompt_start_ms: 0,
      prompt_end_ms: promptEndMs,
      voice1_start_ms: voice1StartMs,
      speech_start_ms: speechStartMs,
      speech_end_ms: speechEndMs,
      response_latency_ms: responseLatencyMs,
      learner_duration_ms: learnerDurationMs,
      duration_delta_ms: durationDeltaMs,
      started_during_prompt: startedDuringPrompt,
      still_speaking_at_voice1: stillSpeakingAtVoice1,
      speech_detected: speechStartMs !== null,
      peak_energy_db: this.peakEnergy === -Infinity ? -100 : this.peakEnergy,
      average_energy_db: averageEnergy,
      envelope,
    };
  }

  /**
   * The energy a sample must exceed to count as speech, right now.
   *
   * Until the calibration slice closes this is the configured absolute
   * threshold; afterwards it is the larger of that and (measured floor +
   * margin). The measured floor is a LOW QUANTILE of the calibration slice
   * (see `calibration_percentile`), not a mean, median or max: a learner
   * speaking during the slice adds energy on top of the playback and can only
   * push samples up, so the estimator has to survive upward contamination —
   * and the median does not survive enough of it.
   */
  private currentSpeechThresholdDb(): number {
    const absolute = this.continuousConfig.energy_threshold_db;
    if (this.adaptiveThresholdDb === null) return absolute;
    return Math.max(absolute, this.adaptiveThresholdDb);
  }

  /**
   * Accumulate the calibration slice and close it once the window elapses (or
   * PROMPT_END arrives first, for a very short prompt). Returns true while
   * calibration is still open, during which no onset may be CONFIRMED — but
   * see `backdateOnsetThroughCalibration`, which recovers an onset that was
   * already under way when the slice closed.
   */
  private updateCalibration(relativeNow: number, energy: number): boolean {
    if (!this.continuousConfig.adaptive_floor_enabled) return false;
    if (this.calibrationClosed) return false;

    const promptEnd = this.phaseTimestamps.get('PROMPT_END');
    const windowElapsed = relativeNow >= this.continuousConfig.calibration_window_ms;
    const promptEnded = promptEnd !== undefined && relativeNow >= promptEnd;

    if (!windowElapsed && !promptEnded) {
      this.calibrationSamples.push(energy);
      return true;
    }

    this.calibrationClosed = true;
    if (this.calibrationSamples.length >= this.continuousConfig.calibration_min_samples) {
      const sorted = [...this.calibrationSamples].sort((a, b) => a - b);
      const q = Math.min(Math.max(this.continuousConfig.calibration_percentile, 0), 1);
      const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
      this.adaptiveThresholdDb = sorted[idx] + this.continuousConfig.adaptive_margin_db;
      this.backdateOnsetThroughCalibration();
    }
    // Too few samples → adaptiveThresholdDb stays null and the absolute
    // threshold governs, rather than a floor built on two frames of noise.
    return false;
  }

  /**
   * Recover the onset of an utterance that was ALREADY IN PROGRESS when the
   * calibration slice closed.
   *
   * The slice cannot judge its own samples as they arrive — there is no floor
   * yet to judge them against. But the moment the floor exists, the slice can
   * be re-read: walk backwards from its last sample while the energy is above
   * the freshly measured floor, and the start of that run is when the learner
   * actually began. Without this, the most confident speaker there is — the
   * one who answers 200ms in because they already knew it — was credited at
   * the moment calibration happened to close, and that inflated latency was
   * reported as truth (measured: onset 200ms, reported 432ms).
   *
   * Only ever called with a measured floor in hand. Under the starved-
   * calibration fallback there is no floor, the absolute threshold governs,
   * and back-dating there would hand the whole cycle back to playback — which
   * is the original bug, so it is deliberately not done.
   *
   * The candidate seeded here is not yet an onset: it still has to clear the
   * sustain test and the prompt-boundary test like any other.
   */
  private backdateOnsetThroughCalibration(): void {
    if (this.firstSpeechStartAbsolute !== null) return;
    if (this.candidateSpeechStart !== null) return;

    const threshold = this.currentSpeechThresholdDb();
    const timeline = this.continuousEnergyTimeline;
    if (timeline.length === 0) return;
    // The run must reach the end of the slice; an earlier burst that already
    // died inside it is not what the learner is still saying now.
    if (timeline[timeline.length - 1].db <= threshold) return;

    let i = timeline.length - 1;
    while (i > 0 && timeline[i - 1].db > threshold) i--;

    this.candidateSpeechStart = timeline[i].t;
    this.candidateSustained = false;
    this.candidateRunEnd = null;
  }

  /**
   * Resolve a sustained candidate whose onset lies inside the prompt window,
   * using the prompt-end boundary rather than level. See
   * `prompt_boundary_guard_ms` for why level alone cannot do this.
   *
   * @param relativeNow  now, relative to prompt start
   * @param stillAbove   is the run still above the floor at `relativeNow`?
   * @returns 'learner' to confirm, 'bleed' to discard and re-arm, 'pending'
   *          to keep waiting for the boundary to arrive.
   */
  private resolvePromptWindowCandidate(
    relativeNow: number,
    stillAbove: boolean
  ): 'learner' | 'bleed' | 'pending' {
    const promptEnd = this.phaseTimestamps.get('PROMPT_END');
    if (promptEnd === undefined) return 'pending';
    const guard = this.continuousConfig.prompt_boundary_guard_ms;

    // Escape hatch: a zero (or negative) guard turns the boundary test off
    // and leaves the energy margin alone in charge, as it was before.
    if (guard <= 0) return 'learner';

    if (stillAbove) {
      // Outlived the prompt by the guard → cannot be the prompt.
      return relativeNow >= promptEnd + guard ? 'learner' : 'pending';
    }
    // Fell back to the floor while the prompt was still audibly playing →
    // cannot be the prompt either. This is the short early answer.
    if (relativeNow < promptEnd - guard) return 'learner';
    // Died with the prompt.
    return 'bleed';
  }

  /**
   * Whether a NEW utterance may still begin. The learner is invited to speak
   * between PROMPT_END and VOICE_1; once the app starts playing target audio
   * an onset is far likelier to be that audio than a response, and the
   * response-latency measurement it would produce is meaningless anyway.
   * Speech already in progress is unaffected — which is what keeps
   * `still_speaking_at_voice1` measurable.
   */
  private onsetWindowOpen(relativeNow: number): boolean {
    const voice1 = this.phaseTimestamps.get('VOICE_1');
    return voice1 === undefined || relativeNow < voice1;
  }

  /** Has the pending candidate stayed up long enough to be an utterance
   *  rather than a door, a tap or a click? */
  private candidateIsSustained(now: number): boolean {
    return (
      this.candidateSpeechStart !== null &&
      now - this.candidateSpeechStart >= this.continuousConfig.min_speech_duration_ms
    );
  }

  /**
   * Decide, with whatever is known right now, whether the pending sustained
   * candidate is the learner, the app's own prompt audio, or still
   * undecidable. Called every frame while a sustained candidate is pending,
   * and once more at stop.
   *
   * PROMPT_END is marked by the player when the prompt audio actually
   * finishes, which is normally LONG after the candidate began — so this
   * cannot be settled when the candidate is created. It is settled here, on
   * whichever frame the information finally exists.
   *
   * @param relativeNow now, relative to prompt start
   * @param atStop      final call: no more information is coming, so an
   *                    unmarked PROMPT_END means the boundary test is simply
   *                    unavailable and the candidate is taken at face value.
   */
  private tryResolveCandidate(relativeNow: number, atStop = false): void {
    if (this.firstSpeechStartAbsolute !== null) return;
    if (this.candidateSpeechStart === null || !this.candidateSustained) return;

    const promptEnd = this.phaseTimestamps.get('PROMPT_END');
    if (promptEnd === undefined) {
      // No boundary to judge against. Wait for one — unless nothing more is
      // coming, in which case fall back to believing the candidate rather
      // than silently losing an utterance.
      if (atStop) this.confirmOnset();
      return;
    }

    const candidateRel = this.candidateSpeechStart - this.continuousStartTime;
    if (candidateRel >= promptEnd) {
      // Onset after the prompt finished: it has already outlived the prompt,
      // so there is nothing for the boundary test to add.
      this.confirmOnset();
      return;
    }

    const stillAbove = this.candidateRunEnd === null;
    const at = stillAbove ? relativeNow : this.candidateRunEnd! - this.continuousStartTime;
    const verdict = this.resolvePromptWindowCandidate(at, stillAbove);

    if (verdict === 'learner') {
      this.confirmOnset();
    } else if (verdict === 'bleed') {
      this.discardCandidate();
    }
  }

  /** Throw the pending candidate away and re-arm for a real response. */
  private discardCandidate(): void {
    this.candidateSpeechStart = null;
    this.candidateSustained = false;
    this.candidateRunEnd = null;
  }

  /** Promote the pending candidate to THE onset for this cycle. */
  private confirmOnset(): void {
    // Credit the START of the burst, not the moment it qualified, so response
    // latency is not inflated by the sustain or boundary tests.
    const onset = this.candidateSpeechStart;
    this.firstSpeechStartAbsolute = onset;

    // Any end recorded by an EARLIER unsustained burst predates the real
    // utterance and would otherwise survive to the result as a speech_end
    // BEFORE speech_start. Only such ends are discarded: confirmation can now
    // happen after the candidate's own run has already finished (a prompt-
    // window candidate waits for PROMPT_END to judge it), and that run's end
    // is the real one — clearing it unconditionally left the short early
    // answer with a start and no end.
    const onsetRel = onset !== null ? onset - this.continuousStartTime : 0;
    if (this.lastSpeechEndAbsolute !== null && this.lastSpeechEndAbsolute <= (onset ?? 0)) {
      this.lastSpeechEndAbsolute = null;
    }
    if (this.confirmedSpeechEnd !== null && this.confirmedSpeechEnd <= onsetRel) {
      this.confirmedSpeechEnd = null;
    }
    if (this.lastSpeechEndAbsolute === null && this.speechEndDebounceTimer) {
      clearTimeout(this.speechEndDebounceTimer);
      this.speechEndDebounceTimer = null;
    }
  }

  /**
   * Internal analysis loop for continuous monitoring.
   * Similar to analyzeLoop but tracks first speech start and debounces speech end.
   */
  private continuousAnalyzeLoop(): void {
    if (!this.isMonitoring || !this.analyser) return;

    const energy = this.getCurrentEnergy();
    const now = performance.now();
    const relativeNow = now - this.continuousStartTime;

    // Record energy sample
    this.energySamples.push(energy);
    this.continuousEnergyTimeline.push({ t: now, db: energy });

    // Track peak
    if (energy > this.peakEnergy) {
      this.peakEnergy = energy;
    }

    const calibrating = this.updateCalibration(relativeNow, energy);

    // Check against threshold. Continuous mode reads continuousConfig — the
    // loop used to read this.config for the threshold and min_frames while
    // reading continuousConfig only for the debounce, so a per-call config
    // passed to startContinuousMonitoring silently did nothing to the gate.
    const isAboveThreshold =
      !calibrating && energy > this.currentSpeechThresholdDb();

    if (isAboveThreshold) {
      this.consecutiveAboveThreshold++;

      // Cancel any pending speech end
      if (this.speechEndDebounceTimer) {
        clearTimeout(this.speechEndDebounceTimer);
        this.speechEndDebounceTimer = null;
      }

      // Confirm speech after min_frames_above consecutive frames
      if (this.consecutiveAboveThreshold >= this.continuousConfig.min_frames_above) {
        if (this.lastSpeechStartTime === null) {
          // Speech just started
          this.lastSpeechStartTime = now;
        }
        this.speechFrameCount++;

        // Track first speech start for timing analysis. Two gates the old
        // code had neither of: the burst must be inside the onset window,
        // and it must SUSTAIN for min_speech_duration_ms before it counts.
        // min_speech_duration_ms was declared and defaulted since the class
        // was written but never actually read anywhere — so a single ~48ms
        // transient (three rAF frames) established the onset for the whole
        // cycle, permanently, with no way to re-arm.
        if (this.firstSpeechStartAbsolute === null) {
          if (this.candidateSpeechStart === null) {
            if (this.onsetWindowOpen(relativeNow)) {
              this.candidateSpeechStart = this.lastSpeechStartTime;
              this.candidateSustained = false;
              this.candidateRunEnd = null;
            }
          } else if (this.candidateRunEnd === null && this.candidateIsSustained(now)) {
            this.candidateSustained = true;
          }
          this.tryResolveCandidate(relativeNow);
        }
      }
    } else {
      // Below the floor.
      if (this.firstSpeechStartAbsolute === null && this.candidateSpeechStart !== null) {
        if (!this.candidateSustained) {
          // A transient — a door, a tap, a click. Discarded, so the next
          // burst gets a fresh chance to own the measurement.
          this.discardCandidate();
        } else {
          // Sustained: remember WHERE the run ended and keep holding it. A
          // prompt-window candidate is judged by that moment against
          // PROMPT_END, which is usually marked later, so it must not be
          // thrown away just because it stopped. This is what keeps the short
          // early answer — a learner who answers over the prompt and finishes
          // before it does.
          if (this.candidateRunEnd === null) this.candidateRunEnd = now;
          this.tryResolveCandidate(relativeNow);
        }
      }

      if (this.lastSpeechStartTime !== null) {
        // Speech might be ending - record tentative end time
        this.lastSpeechEndAbsolute = now;

        // Debounce the speech end
        if (!this.speechEndDebounceTimer) {
          this.speechEndDebounceTimer = setTimeout(() => {
            // Confirm speech end after debounce period
            if (this.lastSpeechEndAbsolute !== null) {
              this.confirmedSpeechEnd = this.lastSpeechEndAbsolute - this.continuousStartTime;
            }
            this.speechEndDebounceTimer = null;
          }, this.continuousConfig.speech_end_debounce_ms);
        }

        // Update total speech duration
        this.totalSpeechDuration += now - this.lastSpeechStartTime;
        this.lastSpeechStartTime = null;
      }
      this.consecutiveAboveThreshold = 0;
    }

    // Continue loop
    this.rafId = requestAnimationFrame(() => this.continuousAnalyzeLoop());
  }
}

/**
 * Factory function to create VoiceActivityDetector
 */
export function createVoiceActivityDetector(config?: Partial<VADConfig>): VoiceActivityDetector {
  return new VoiceActivityDetector(config);
}
