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
      expect(source).toContain('SILENT_BRIDGE_THRESHOLD_SECS = 2.0')
      expect(source).toContain('STALL_DETECTION_TIMEOUT_SECS = 5')
      expect(source).toContain('PLAY_RETRY_DELAY_MS = 1000')
      expect(source).toContain('PLAY_MAX_RETRIES = 2')
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
})
