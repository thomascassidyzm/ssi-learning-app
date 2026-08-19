import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HowThisWorksLearner from './HowThisWorksLearner.vue'
import WhyThisWorks from './WhyThisWorks.vue'
import ExplainerFigure from './ExplainerFigure.vue'
import { LEARNER_EXPLAINER_SEEN_KEY } from '@/explainer/learnerThrob'
import {
  HOW_THIS_WORKS_LEARNER,
  WHY_THIS_WORKS,
  type ExplainerFigureName,
} from '@/explainer/learnerExplainers'

// These sections read their prose from Popty where one has been published.
// Nothing here is about that, so keep the suite off the network entirely and
// let both components sit on their hardcoded fallback.
vi.mock('@/explainer/usePublishedExplainers', async () => {
  const real = await import('@/explainer/learnerExplainers')
  const { computed } = await import('vue')
  return {
    loadPublishedExplainers: () => {},
    usePublishedExplainers: () => ({
      howThisWorks: computed(() => real.HOW_THIS_WORKS_LEARNER),
      whyThisWorks: computed(() => real.WHY_THIS_WORKS),
    }),
  }
})

describe('learner explainer sections — the pulse-until-viewed mechanic', () => {
  beforeEach(() => window.localStorage.clear())

  it('nothing auto-opens: both sections start closed, showing only their link', () => {
    const how = mount(HowThisWorksLearner)
    const why = mount(WhyThisWorks)
    expect(how.find('.lx-card').exists()).toBe(false)
    expect(why.find('.wx-card').exists()).toBe(false)
    expect(how.text()).toContain('How this works')
    expect(why.text()).toContain('Why this works')
  })

  it('carries a pulsing dot until first open, then never again', async () => {
    const how = mount(HowThisWorksLearner)
    expect(how.find('.lx-dot').exists()).toBe(true)

    await how.find('.lx-toggle').trigger('click')
    expect(how.find('.lx-card').exists()).toBe(true)
    expect(how.find('.lx-dot').exists()).toBe(false)

    // Closing again does not re-arm, and neither does a fresh mount.
    await how.find('.lx-toggle').trigger('click')
    expect(how.find('.lx-dot').exists()).toBe(false)
    expect(mount(HowThisWorksLearner).find('.lx-dot').exists()).toBe(false)
  })

  it('records seen-state under the one shared key', async () => {
    await mount(WhyThisWorks).find('.wx-toggle').trigger('click')
    const map = JSON.parse(window.localStorage.getItem(LEARNER_EXPLAINER_SEEN_KEY) || '{}')
    expect(Object.keys(map)).toEqual(['anon:why-this-works'])
  })

  it('keeps seen-state per viewer when the mount knows the account', async () => {
    await mount(WhyThisWorks, { props: { viewerId: 'learner-7' } }).find('.wx-toggle').trigger('click')
    expect(mount(WhyThisWorks, { props: { viewerId: 'learner-7' } }).find('.wx-dot').exists()).toBe(false)
    expect(mount(WhyThisWorks, { props: { viewerId: 'learner-9' } }).find('.wx-dot').exists()).toBe(true)
  })

  it('the two sections are independent: opening one leaves the other armed', async () => {
    await mount(HowThisWorksLearner).find('.lx-toggle').trigger('click')
    expect(mount(WhyThisWorks).find('.wx-dot').exists()).toBe(true)
  })

  it('renders the whole section, headings and all, once open', async () => {
    const why = mount(WhyThisWorks)
    await why.find('.wx-toggle').trigger('click')
    const text = why.text()
    expect(why.findAll('.wx-block').length).toBeGreaterThanOrEqual(5)
    expect(text).toContain('thirty hours')
    expect(text).toMatch(/no points, no score and no leaderboard/)
  })

  it('renders no raw HTML: the prose is plain text interpolation', async () => {
    const how = mount(HowThisWorksLearner)
    await how.find('.lx-toggle').trigger('click')
    expect(how.find('.lx-card').html()).not.toContain('v-html')
  })

  /**
   * The still portrait of the player's phase pill (A-176). It illustrates one
   * block and must stay inert — the live pill is interactive, this one is a
   * picture.
   */
  it('draws the pill figure once, in the block that names it', async () => {
    const how = mount(HowThisWorksLearner)
    await how.find('.lx-toggle').trigger('click')
    expect(how.findAll('.cpf')).toHaveLength(1)

    const block = how.findAll('.lx-block').find((b) => b.find('.cpf').exists())!
    expect(block.find('.lx-heading').text()).toMatch(/pressing play/i)
  })

  it('the figure is a picture, not a control: four segments, no buttons', async () => {
    const how = mount(HowThisWorksLearner)
    await how.find('.lx-toggle').trigger('click')
    const fig = how.find('.cpf')
    expect(fig.findAll('.cpf-seg')).toHaveLength(4)
    expect(fig.findAll('button')).toHaveLength(0)
    expect(fig.find('.cpf-pill').attributes('aria-hidden')).toBe('true')
    // A text alternative in the learner's own words, never internal phase names.
    expect(fig.find('.cpf-caption').text()).toMatch(/your turn to say it out loud/i)
    expect(fig.text()).not.toMatch(/PROMPT|VOICE_1|SPEAK/)
  })

  /**
   * The rest of the drawings (A-159 Parts 2 and 3). Every figure the prose
   * module names must actually draw something: a name with no component behind
   * it fails the typecheck, and a component that renders nothing fails here.
   */
  it('draws every figure the prose names, in the block that names it', async () => {
    const how = mount(HowThisWorksLearner)
    const why = mount(WhyThisWorks)
    await how.find('.lx-toggle').trigger('click')
    await why.find('.wx-toggle').trigger('click')

    for (const [section, wrapper, blockSel, headingSel] of [
      [HOW_THIS_WORKS_LEARNER, how, '.lx-block', '.lx-heading'],
      [WHY_THIS_WORKS, why, '.wx-block', '.wx-heading'],
    ] as const) {
      const drawn = section.blocks.filter((b) => b.figure)
      const blocks = wrapper.findAll(blockSel)
      expect(blocks.filter((b) => b.find('figure').exists())).toHaveLength(drawn.length)

      for (const block of drawn) {
        const rendered = blocks.find((b) => b.find(headingSel).text() === block.heading)!
        expect(rendered.find('figure svg').exists(), block.heading).toBe(true)
      }
    }
  })

  it('gives every drawing a described role and no animation', () => {
    const NAMES: ExplainerFigureName[] = [
      'cycle-pill', 'three-gaps', 'spacing-returns',
      'listening-stretch', 'worn-path', 'climbing-band',
    ]
    for (const name of NAMES) {
      const fig = mount(ExplainerFigure, { props: { name } })
      const html = fig.html()
      // The pill is a div stack captioned in prose; the drawn figures are SVGs
      // that describe themselves. Either way there is a text alternative.
      const svg = fig.find('svg[role="img"]')
      if (svg.exists()) {
        expect(svg.attributes('aria-label')!.length, name).toBeGreaterThan(20)
      } else {
        expect(fig.text().trim().length, name).toBeGreaterThan(20)
      }
      // Part 1's breathing dot is the only moving thing in the explainer.
      expect(html, name).not.toContain('animate')
    }
  })

  /**
   * The player screen (A-176). Small and tappable in the card; the labelled
   * version gets a full-width surface of its own, because the labels are what
   * will not fit beside a 302-wide card.
   */
  it('offers the screen as a thumbnail, with nothing open until it is tapped', async () => {
    const how = mount(HowThisWorksLearner, { attachTo: document.body })
    await how.find('.lx-toggle').trigger('click')
    expect(how.findAll('.psf-thumb')).toHaveLength(1)
    expect(how.find('.psf-thumb').text()).toMatch(/show me the screen/i)
    expect(document.querySelector('.psf-sheet')).toBeNull()
    how.unmount()
  })

  it('tapping it opens the labelled version, and it closes again', async () => {
    const how = mount(HowThisWorksLearner, { attachTo: document.body })
    await how.find('.lx-toggle').trigger('click')
    await how.find('.psf-thumb').trigger('click')

    const sheet = document.querySelector('.psf-sheet')!
    expect(sheet).not.toBeNull()
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    // Four things named, each with a pin on the picture and a line beneath it.
    expect(sheet.querySelectorAll('.psf-pin')).toHaveLength(4)
    expect(sheet.querySelectorAll('.psf-legend-row')).toHaveLength(4)
    expect(sheet.textContent).toMatch(/the only button that matters/i)
    expect(sheet.textContent).toMatch(/offline downloads live here/i)

    await (sheet.querySelector('.psf-close') as HTMLElement).click()
    await how.vm.$nextTick()
    expect(document.querySelector('.psf-sheet')).toBeNull()
    // The scroll lock is handed back on close.
    expect(document.body.style.overflow).toBe('')
    how.unmount()
  })
})
