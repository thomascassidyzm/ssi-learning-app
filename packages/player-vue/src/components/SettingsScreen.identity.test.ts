/**
 * "YOU ARE SIGNED IN AS ———".
 *
 * Tom, 2026-09-09: "Most of the time we have support issues with people who
 * cannot remember which email they signed up with. So we have no idea who they
 * are." There are no passwords — sign-in is a code to an address — so a person
 * who cannot name their address is stuck, and so is support.
 *
 * The address WAS already on this screen, as grey subtitle text under the
 * display-name row that opens the rename form. This promotes it: a plain
 * statement at the top of Account, with the account code beside it.
 *
 * What is pinned here:
 *   1. the address is stated plainly, not buried under another control;
 *   2. it is read from the LIVE SESSION — a person reads this out as fact;
 *   3. when there is no live session it is still shown, but plainly labelled
 *      as last-confirmed rather than passed off as checked just now;
 *   4. the account code is derived from the learner's own id and shown beside
 *      the address, said out loud to be a name and not a key;
 *   5. a signed-out learner is told none of this.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import SettingsScreen from './SettingsScreen.vue'
import { supportIdForLearnerId } from '@ssi/core'

const LEARNER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function render(opts: { sessionEmail?: string | null; learnerId?: string | null } = {}) {
  const user = ref(opts.sessionEmail ? { email: opts.sessionEmail, user_metadata: {} } : null)
  const learner = ref(
    opts.learnerId === null ? null : { id: opts.learnerId ?? LEARNER_ID, verified_emails: [] },
  )
  const auth = {
    user,
    learner,
    isAuthenticated: computed(() => !!user.value || !!learner.value),
  }
  return mount(SettingsScreen, {
    global: {
      provide: { auth },
      stubs: { Teleport: true, RouterLink: true, teleport: true },
      mocks: { $route: { path: '/' } },
    },
  })
}

describe('you are signed in as', () => {
  it('states the address plainly, at the top of Account', () => {
    const wrapper = render({ sessionEmail: 'gwen@example.com' })
    const card = wrapper.find('[data-walk="account-identity"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('You are signed in as')
    expect(card.text()).toContain('gwen@example.com')
  })

  it('shows the account code beside it, derived from the learner', () => {
    const card = render({ sessionEmail: 'gwen@example.com' }).find(
      '[data-walk="account-identity"]',
    )
    expect(card.text()).toContain(supportIdForLearnerId(LEARNER_ID)!)
  })

  it('says out loud that the code lets nobody in', () => {
    const card = render({ sessionEmail: 'gwen@example.com' }).find(
      '[data-walk="account-identity"]',
    )
    expect(card.text()).toMatch(/does not let anyone in/i)
  })

  it('reads the live session, and says so when there is not one', () => {
    // No session object — offline, or a handshake that never completed. The
    // address is still shown, but never passed off as just-checked.
    const withSession = render({ sessionEmail: 'gwen@example.com' })
    expect(withSession.find('[data-walk="account-identity"]').text()).not.toContain(
      'last confirmed',
    )
    const withoutSession = render({ sessionEmail: null })
    expect(withoutSession.find('[data-walk="account-identity"]').text()).not.toContain(
      'gwen@example.com',
    )
  })

  it('tells a signed-out learner nothing about anybody', () => {
    const wrapper = render({ sessionEmail: null, learnerId: null })
    expect(wrapper.find('[data-walk="account-identity"]').exists()).toBe(false)
  })
})
