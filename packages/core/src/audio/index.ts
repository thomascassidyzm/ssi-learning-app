/**
 * Audio analysis module
 *
 * Phase 1: Voice Activity Detection (VAD)
 * Phase 1.5: Continuous VAD & Speech Timing (for timing analysis)
 * Phase 2: Prosody-based pronunciation feedback
 */

export * from './types';
export { VoiceActivityDetector, createVoiceActivityDetector } from './VoiceActivityDetector';
export {
  SpeechTimingAnalyzer,
  createSpeechTimingAnalyzer,
  type SpeechTimingEvent,
  type SpeechTimingEventListener,
} from './SpeechTimingAnalyzer';
export {
  extractPitchContour,
  toSemitones,
  dtw,
  compareProsody,
  getWeightsForLanguage,
  getNativePitchContour,
  clearNativePitchCache,
  trimSilence,
  countEnergyPeaks,
  normalizeEnvelope,
  envelopeSimilarity,
  AudioRecorder,
  type PitchContour,
  type ProsodyScore,
  type PronunciationResult,
  type ProsodyWeights,
} from './PronunciationEngine';
