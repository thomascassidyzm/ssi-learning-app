import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HowThisWorksLearner from './HowThisWorksLearner.vue'
import WhyThisWorks from './WhyThisWorks.vue'
import { LEARNER_EXPLAINER_SEEN_KEY } from '@/explainer/learnerThrob'

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
})
