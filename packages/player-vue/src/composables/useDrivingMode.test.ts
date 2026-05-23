/**
 * useDrivingMode Hardening Tests
 *
 * Tests the hardening features: stall detection, play retry, skip race condition,
 * and the silent bridge threshold constant.
 *
 * Since useDrivingMode requires Vue lifecycle (onUnmounted) and complex audio
 * infrastructure (AudioContext, concatenation), we test the hardening logic
 * by verifying the constants and testing key behavioral patterns via source analysis.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const SOURCE_PATH = resolve(__dirname, 'useDrivingMode.ts')
const source = readFileSync(SOURCE_PATH, 'utf-8')

describe('useDrivingMode hardening', () => {
  describe('constants', () => {
    it('has correct hardening constants defined', () => {
      // Per-transition silent-bridge replaced by useAudioSessionKeepalive
      // (session-wide). The bridge constant is gone.
      expect(source).toContain('STALL_DETECTION_TIMEOUT_SECS = 5')
      expect(source).toContain('PLAY_RETRY_DELAY_MS = 1000')
      expect(source).toContain('PLAY_MAX_RETRIES = 2')
    })

    it('defaults the chunked-prefetch size to 50 MB', () => {
      // Tom's spec: ~50 MB per chunk so activation isn't gated on the
      // long tail. Constant must stay in sync with the brief.
      expect(source).toContain('DEFAULT_CHUNK_BYTES = 50 * 1024 * 1024')
    })
  })

  describe('preloadGeneration pattern', () => {
    it('uses preloadGeneration to guard stale preloads', () => {
      expect(source).toContain('let preloadGeneration = 0')
      expect(source).toContain('preloadGeneration++')
      expect(source).toContain('generation !== preloadGeneration')
      expect(source).toContain('const generation = preloadGeneration')
    })
  })

  describe('stall detection pattern', () => {
    it('implements stall detection with recovery', () => {
      expect(source).toContain('startStallDetection')
      expect(source).toContain('stopStallDetection')
      expect(source).toContain('recoverFromStall')
      expect(source).toContain('mainAudio.currentTime = pos + 0.1')
      expect(source).toContain('handleMainAudioEnded')
    })
  })

  describe('playWithRetry pattern', () => {
    it('implements retry loop with fallback to next round', () => {
      expect(source).toContain('async function playWithRetry')
      expect(source).toContain('for (let attempt = 0; attempt <= retries; attempt++)')
      expect(source).toContain('PLAY_RETRY_DELAY_MS')
      expect(source).toContain('failed after all retries, transitioning')
      expect(source).toContain('handleMainAudioEnded()')
    })
  })

  describe('skip cleanup', () => {
    it('cleans up stale preloads on skip', () => {
      expect(source).toContain('async function skipToNextRound')
      expect(source).toMatch(/skipToNextRound[\s\S]*?preloadGeneration\+\+/)
      expect(source).toContain('async function skipToPreviousRound')
    })
  })

  describe('cleanup on exit', () => {
    it('stops stall detection on cleanup', () => {
      expect(source).toMatch(/function cleanup[\s\S]*?stopStallDetection/)
      expect(source).toMatch(/function cleanup[\s\S]*?preloadGeneration = 0/)
    })
  })

  describe('chunked prefetch (cache warm before concatenation)', () => {
    it('declares optional prefetchAudio + getRoundAudioIds options', () => {
      // These are the contract surface for chunked downloads — the caller
      // (LearningPlayer) wires them to BundleDownloader.
      expect(source).toContain('prefetchAudio?:')
      expect(source).toContain('getRoundAudioIds?:')
      expect(source).toContain('chunkBytes?:')
    })

    it('calls prefetchForRound before concatenateRound inside loadRound', () => {
      // Order matters: cache warm THEN concat. Otherwise concat does its
      // own (serial, slow) network fetches and the prefetch is wasted.
      expect(source).toMatch(
        /await prefetchForRound\([\s\S]*?await concatenateRound/,
      )
    })

    it('passes maxBytes from chunkBytes option into prefetchAudio', () => {
      // The size cap is the whole point of chunking — verify the option
      // actually reaches the caller.
      expect(source).toMatch(/options\.prefetchAudio\([\s\S]*?maxBytes/)
    })

    it('absorbs prefetch errors so concatenation falls back to direct fetch', () => {
      // The brief: "Errors from prefetch are absorbed — concatenateRound
      // has its own fallback path." Verify the try/catch is in place.
      expect(source).toMatch(
        /async function prefetchForRound[\s\S]*?try \{[\s\S]*?await options\.prefetchAudio[\s\S]*?\} catch/,
      )
    })

    it('no-ops cleanly when caller did not wire chunked prefetch', () => {
      // Backward compat: existing callers (and tests, demos) don't pass
      // prefetchAudio/getRoundAudioIds. Source must guard against undefined.
      expect(source).toMatch(
        /if \(!options\.prefetchAudio \|\| !options\.getRoundAudioIds\) return/,
      )
    })
  })
})
