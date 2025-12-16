/**
 * Audio analysis module
 *
 * Phase 1: Voice Activity Detection (VAD)
 * Phase 2: Prosody Analysis (types defined, implementation deferred)
 */

export * from './types';
export { VoiceActivityDetector, createVoiceActivityDetector } from './VoiceActivityDetector';
