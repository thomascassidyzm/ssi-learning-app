/**
 * Audio analysis module
 *
 * Phase 1: Voice Activity Detection (VAD)
 * Phase 1.5: Continuous VAD & Speech Timing (for timing analysis)
 * Phase 2: Prosody Analysis (types defined, implementation deferred)
 */

export * from './types';
export { VoiceActivityDetector, createVoiceActivityDetector } from './VoiceActivityDetector';
export {
  SpeechTimingAnalyzer,
  createSpeechTimingAnalyzer,
  type SpeechTimingEvent,
  type SpeechTimingEventListener,
} from './SpeechTimingAnalyzer';
