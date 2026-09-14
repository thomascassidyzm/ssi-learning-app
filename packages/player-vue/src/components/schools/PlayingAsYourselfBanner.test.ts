/**
 * Tom, 2026-09-14 16:17Z (job #683): the "You are now playing as yourself"
 * warning belongs where the player is playing, not on a dashboard where
 * nothing plays. Red before the banner existed on the player; green after.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayingAsYourselfBanner from './PlayingAsYourselfBanner.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useUserRole } from '@/composables/useUserRole'

const RouterLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }
const play = (playing: boolean) => window.dispatchEvent(new CustomEvent('ssi-play-state', { detail: { playing } }))

describe('PlayingAsYourselfBanner — live own-account play, on the player', () => {
  beforeEach(() => {
    useSchoolContext().currentUser.value = { user_id: 'u1', learner_id: 'l1', display_name: 'Bethan', educational_role: 'teacher', platform_role: null } as any
    useUserRole().viewingAs.value = null
  })

  it('shows nothing until the player is actually playing', () => {
    const w = mount(PlayingAsYourselfBanner, { global: { stubs: { RouterLink: RouterLinkStub } } })
    expect(w.find('[data-walk="player-playing-as-yourself"]').exists()).toBe(false)
  })

  it('while a teacher plays on her own account it says so in Tom\'s words and links to her classes, and goes when play stops', async () => {
    const w = mount(PlayingAsYourselfBanner, { global: { stubs: { RouterLink: RouterLinkStub } } })
    play(true); await w.vm.$nextTick()
    const el = w.find('[data-walk="player-playing-as-yourself"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toContain('You are now playing as yourself. If you want to play as class please go here.')
    expect(el.find('a').attributes('href')).toBe('/schools/classes')
    play(false); await w.vm.$nextTick()
    expect(w.find('[data-walk="player-playing-as-yourself"]').exists()).toBe(false)
  })

  it('a learner with no school role never sees it', async () => {
    useSchoolContext().currentUser.value = { user_id: 'u2', learner_id: 'l2', display_name: 'Sam', educational_role: 'student', platform_role: null } as any
    const w = mount(PlayingAsYourselfBanner, { global: { stubs: { RouterLink: RouterLinkStub } } })
    play(true); await w.vm.$nextTick()
    expect(w.find('[data-walk="player-playing-as-yourself"]').exists()).toBe(false)
  })

  it('never under View As', async () => {
    useUserRole().viewingAs.value = { key: 'user:x', userId: 'x', role: 'teacher', name: 'Someone' } as any
    const w = mount(PlayingAsYourselfBanner, { global: { stubs: { RouterLink: RouterLinkStub } } })
    play(true); await w.vm.$nextTick()
    expect(w.find('[data-walk="player-playing-as-yourself"]').exists()).toBe(false)
  })
})
