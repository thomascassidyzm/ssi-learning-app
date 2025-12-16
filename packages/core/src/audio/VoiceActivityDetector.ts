/**
 * VoiceActivityDetector - Real-time voice activity detection using Web Audio API
 *
 * Detects when the learner is speaking during the PAUSE phase by monitoring
 * microphone input energy levels. Browser-only, no server storage.
 *
 * Usage:
 *   const vad = new VoiceActivityDetector(config);
 *   await vad.initialize(); // Must be called from user gesture
 *   vad.startMonitoring();  // Call at PAUSE start
 *   const result = vad.stopMonitoring(); // Call at PAUSE end
 */

import type { VADConfig, VADResult, VADStatus } from './types';
import { DEFAULT_VAD_CONFIG } from '../config/defaults';

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

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
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
}

/**
 * Factory function to create VoiceActivityDetector
 */
export function createVoiceActivityDetector(config?: Partial<VADConfig>): VoiceActivityDetector {
  return new VoiceActivityDetector(config);
}
