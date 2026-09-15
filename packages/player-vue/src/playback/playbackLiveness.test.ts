/**
 * Job #693, gap 1b: Listening Mode's transport must count as live play for
 * chrome outside the player tree (the playing-as-yourself banner). The
 * overlay is a 2,000-line plain-JS SFC, so its wiring is pinned at source
 * level, the way ListeningOverlay.scope.test.ts pins it: red on the #683
 * code, where only LearningPlayer echoed play state; green once both
 * transports report through playbackLiveness.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isAnyPlaybackLive, setPlaybackLive, resetPlaybackLiveness } from './playbackLiveness'

const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8')

describe('playbackLiveness — one answer for "is any audio session live"', () => {
  beforeEach(() => resetPlaybackLiveness())

  it('is the OR of every transport, and echoes changes on the window as ssi-play-state', () => {
    const seen: boolean[] = []
    const on = (e: Event) => seen.push(!!(e as CustomEvent<{ playing: boolean }>).detail?.playing)
    window.addEventListener('ssi-play-state', on)
    setPlaybackLive('player', true)
    setPlaybackLive('listening', true)
    setPlaybackLive('player', false)
    expect(isAnyPlaybackLive.value).toBe(true)
    setPlaybackLive('listening', false)
    expect(isAnyPlaybackLive.value).toBe(false)
    window.removeEventListener('ssi-play-state', on)
    expect(seen).toEqual([true, false])
  })

  it('both transports report themselves: the main player and Listening Mode', () => {
    const player = src('components/LearningPlayer.vue')
    expect(player).toMatch(/setPlaybackLive\('player', playing\)/)
    const overlay = src('components/ListeningOverlay.vue')
    const watcher = overlay.match(/watch\(isPlaying, async \(playing\) => \{[\s\S]*?\n\}\)/)?.[0] ?? ''
    expect(watcher).toMatch(/setPlaybackLive\('listening', playing\)/)
    expect(overlay).toMatch(/setPlaybackLive\('listening', false\)/)
  })
})
