/**
 * SchoolsPasswordPrompt — the same card is mounted on an organisation's node
 * home (NodeHomeView) as on a school's, so its one sentence must not call the
 * reader's workplace a school. Job #786: Deborah, setting herself up as the
 * Group Leader of a test organisation, read "school email filters often
 * swallow those".
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import SchoolsPasswordPrompt from './SchoolsPasswordPrompt.vue'

describe('SchoolsPasswordPrompt wording', () => {
  it('explains the password without calling the account a school account', () => {
    const w = mount(SchoolsPasswordPrompt, {
      global: {
        provide: { auth: { user: ref({ id: 'u-1', email: 'leader@museum.wales', user_metadata: {} }) } },
        stubs: { ManagerOnboardingGate: true },
      },
    })
    const body = w.find('.pw-body').text()
    expect(body).toContain('code emailed to you')
    expect(body).not.toMatch(/\bschool\b/i)
  })
})
