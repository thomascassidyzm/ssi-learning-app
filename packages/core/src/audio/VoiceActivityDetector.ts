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

    // Finalize speech end if still speaking
    if (this.lastSpeechStartTime !== null && this.confirmedSpeechEnd === null) {
      this.confirmedSpeechEnd = endTime - this.continuousStartTime;
    }

    // Get phase timestamps (relative to prompt start)
    const promptEndMs = this.phaseTimestamps.get('PROMPT_END') ?? 0;
    const voice1StartMs = this.phaseTimestamps.get('VOICE_1') ?? 0;

    // Calculate speech timestamps (relative to prompt start)
    const speechStartMs = this.firstSpeechStartAbsolute !== null
      ? this.firstSpeechStartAbsolute - this.continuousStartTime
      : null;
    const speechEndMs = this.confirmedSpeechEnd ?? (
      this.lastSpeechEndAbsolute !== null
        ? this.lastSpeechEndAbsolute - this.continuousStartTime
        : null
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
    };
  }

  /**
   * Internal analysis loop for continuous monitoring.
   * Similar to analyzeLoop but tracks first speech start and debounces speech end.
   */
  private continuousAnalyzeLoop(): void {
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

      // Cancel any pending speech end
      if (this.speechEndDebounceTimer) {
        clearTimeout(this.speechEndDebounceTimer);
        this.speechEndDebounceTimer = null;
      }

      // Confirm speech after min_frames_above consecutive frames
      if (this.consecutiveAboveThreshold >= this.config.min_frames_above) {
        if (this.lastSpeechStartTime === null) {
          // Speech just started
          this.lastSpeechStartTime = now;

          // Track first speech start for timing analysis
          if (this.firstSpeechStartAbsolute === null) {
            this.firstSpeechStartAbsolute = now;
          }
        }
        this.speechFrameCount++;
      }
    } else {
      // Below threshold
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
