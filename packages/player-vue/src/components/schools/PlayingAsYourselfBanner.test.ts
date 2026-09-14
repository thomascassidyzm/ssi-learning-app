/**
 * Tom, 2026-09-14 16:17Z (job #683): the "You are now playing as yourself"
 * warning belongs where the player is playing, not on a dashboard where
 * nothing plays. Red before the banner existed on the player; green after.
 *
 * Job #693 (two gaps in #683): a teacher opening the app cold, straight into
 * the player, has no school context yet — her role is only in the cache; and
 * Listening Mode's transport is play too. Both red on the #683 banner.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayingAsYourselfBanner from './PlayingAsYourselfBanner.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useUserRole } from '@/composables/useUserRole'
import { setPlaybackLive, resetPlaybackLiveness } from '@/playback/playbackLiveness'

const RouterLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }
const play = (playing: boolean) => setPlaybackLive('player', playing)
const SEL = '[data-walk="player-playing-as-yourself"]'
const mountBanner = () => mount(PlayingAsYourselfBanner, { global: { stubs: { RouterLink: RouterLinkStub } } })

describe('PlayingAsYourselfBanner — live own-account play, on the player', () => {
  beforeEach(() => {
    resetPlaybackLiveness()
    useUserRole().clear()
    localStorage.clear()
    useSchoolContext().currentUser.value = { user_id: 'u1', learner_id: 'l1', display_name: 'Bethan', educational_role: 'teacher', platform_role: null } as any
    useUserRole().viewingAs.value = null
  })

  it('shows nothing until the player is actually playing', () => {
    const w = mountBanner()
    expect(w.find(SEL).exists()).toBe(false)
  })

  it('while a teacher plays on her own account it says so in Tom\'s words and links to her classes, and goes when play stops', async () => {
    const w = mountBanner()
    play(true); await w.vm.$nextTick()
    const el = w.find(SEL)
    expect(el.exists()).toBe(true)
    expect(el.text()).toContain('You are now playing as yourself. If you want to play as class please go here.')
    expect(el.find('a').attributes('href')).toBe('/schools/classes')
    play(false); await w.vm.$nextTick()
    expect(w.find(SEL).exists()).toBe(false)
  })

  it('a learner with no school role never sees it', async () => {
    useSchoolContext().currentUser.value = { user_id: 'u2', learner_id: 'l2', display_name: 'Sam', educational_role: 'student', platform_role: null } as any
    const w = mountBanner()
    play(true); await w.vm.$nextTick()
    expect(w.find(SEL).exists()).toBe(false)
  })

  it('never under View As', async () => {
    useUserRole().viewingAs.value = { key: 'user:x', userId: 'x', role: 'teacher', name: 'Someone' } as any
    const w = mountBanner()
    play(true); await w.vm.$nextTick()
    expect(w.find(SEL).exists()).toBe(false)
  })

  it('job #693 (a): a teacher who opens the app cold into the player — no school context, role only in the cache — still sees it', async () => {
    useSchoolContext().currentUser.value = null
    localStorage.setItem('ssi-user-role', JSON.stringify({ platformRole: null, educationalRole: 'teacher' }))
    const w = mountBanner()
    play(true); await w.vm.$nextTick()
    expect(w.find(SEL).exists()).toBe(true)
  })

  it('job #693 (a, control): with no school context AND no cached role, a plain learner still sees nothing', async () => {
    useSchoolContext().currentUser.value = null
    const w = mountBanner()
    play(true); await w.vm.$nextTick()
    expect(w.find(SEL).exists()).toBe(false)
  })

  it('job #693 (b): Listening Mode playback on her own account is live play too', async () => {
    const w = mountBanner()
    setPlaybackLive('listening', true); await w.vm.$nextTick()
    expect(w.find(SEL).exists()).toBe(true)
    setPlaybackLive('listening', false); await w.vm.$nextTick()
    expect(w.find(SEL).exists()).toBe(false)
  })
})
