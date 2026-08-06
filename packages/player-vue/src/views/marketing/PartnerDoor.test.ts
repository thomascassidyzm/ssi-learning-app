/**
 * PartnerDoor.vue — the unlinked partner landing page (/znotes is the first
 * instance). Headless Chrome can't launch in this environment, so the render is
 * verified by mounting rather than by a browser.
 *
 * The load-bearing assertions are the COMMERCIAL ones: the page must state the
 * live tutor deal exactly (£15 / £10 / £5), must NOT state an affiliate offer
 * (that lane is undecided, founder exploration 2026-08-03), and must not index.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

import PartnerDoor from './PartnerDoor.vue'
import { PARTNER_DOORS, partnerDoorCopy } from './partners'

function mountDoor(partner = 'znotes') {
  return mount(PartnerDoor, { props: { partner } })
}

afterEach(() => {
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove())
})

describe('PartnerDoor', () => {
  it('renders the znotes door with its kicker and headline', () => {
    const wrapper = mountDoor()
    const text = wrapper.text()
    expect(text).toContain('For the ZNotes community')
    expect(text).toContain('You already teach. This is a way to be paid for it.')
  })

  it('states the live tutor deal — £15 tutor, £10 student, £5 rebate', () => {
    const text = mountDoor().text()
    expect(text).toContain('£15 a month')
    expect(text).toContain('£10 a month')
    expect(text).toContain('£5 a month')
  })

  it('CTAs into the live tutor signup door and nowhere else', () => {
    const wrapper = mountDoor()
    const links = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(links).toContain('/tutors')
    // No stray outbound or checkout links — this page owns no money path.
    expect(links.every((h) => h === '/tutors')).toBe(true)
  })

  it('states NO affiliate/introducer offer (undecided lane)', () => {
    const text = mountDoor().text().toLowerCase()
    for (const banned of ['affiliate', 'introducer', 'referral fee', 'commission', '50/50']) {
      expect(text).not.toContain(banned)
    }
  })

  it('makes no audio-coverage claim (unverified as of 2026-08-03)', () => {
    const text = mountDoor().text().toLowerCase()
    expect(text).not.toContain('audio')
    expect(text).not.toContain('recorded by native speakers')
  })

  it('lists all nineteen first languages the English courses are built from', () => {
    const wrapper = mountDoor()
    const langs = wrapper.findAll('.pd-lang').map((l) => l.text())
    expect(langs).toHaveLength(19)
    expect(langs).toContain('Tamil')
    expect(langs).toContain('Urdu')
  })

  it('adds a noindex robots tag while mounted and removes it on unmount', () => {
    const wrapper = mountDoor()
    const tag = document.head.querySelector('meta[name="robots"]')
    expect(tag?.getAttribute('content')).toContain('noindex')
    wrapper.unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('renders a quiet fallback for an unknown partner slug', () => {
    const wrapper = mountDoor('not-a-partner')
    expect(wrapper.find('.pd-missing').exists()).toBe(true)
    expect(partnerDoorCopy('not-a-partner')).toBeNull()
  })

  it('keys every partner entry by its own slug', () => {
    for (const [key, copy] of Object.entries(PARTNER_DOORS)) {
      expect(copy.slug).toBe(key)
    }
  })
})
