/**
 * TOM'S RULING 3 (job #195, 2026-09-18): at proof, exactly one live session
 * shows nothing; more than one shows ONE line on the proving device with
 * Keep as the default. Keep touches no endpoint. And ruling 2 beside it:
 * proof itself calls nothing that ends a session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import MailboxBanner from './MailboxBanner.vue'

let verifyResponse: any
let fetchCalls: string[]

function mountBanner() {
  const user = ref<any>({ id: 'u1', email: 'head@school.wales', user_metadata: { onboarded_via: 'possession', setup_door: 'school' } })
  const auth = { user, learner: ref({ verified_emails: [] }) }
  const supabase = ref({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } })
  return mount(MailboxBanner, { global: { provide: { auth, supabase } } })
}

async function prove(w: ReturnType<typeof mount>) {
  await w.find('.mailbox-banner__input').setValue('123456')
  await w.find('form.mailbox-banner__form').trigger('submit')
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

describe('MailboxBanner — the second-device line', () => {
  beforeEach(() => {
    fetchCalls = []
    verifyResponse = { success: true, email: 'head@school.wales', other_sessions: 0 }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchCalls.push(String(url))
      return { ok: true, json: async () => verifyResponse } as any
    }))
  })

  it('shows nothing when the proving session is the only one', async () => {
    const w = mountBanner()
    await prove(w)
    expect(w.text()).toContain('sorted for good')
    expect(w.find('.mailbox-banner__sessions').exists()).toBe(false)
    expect(fetchCalls).toEqual(['/api/email/verify'])
  })

  it('shows one line when there is another device, and Keep ends it with no call made', async () => {
    verifyResponse.other_sessions = 1
    const w = mountBanner()
    await prove(w)
    const line = w.find('.mailbox-banner__sessions')
    expect(line.exists()).toBe(true)
    expect(line.text()).toContain('another device')
    await line.findAll('button')[0].trigger('click')
    await nextTick()
    expect(w.find('.mailbox-banner__sessions').exists()).toBe(false)
    expect(fetchCalls).toEqual(['/api/email/verify'])
  })

  it('"Sign it out" is the one tap that calls end-other-sessions', async () => {
    verifyResponse.other_sessions = 2
    const w = mountBanner()
    await prove(w)
    const line = w.find('.mailbox-banner__sessions')
    expect(line.text()).toContain('2 other devices')
    await line.findAll('button')[1].trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    expect(fetchCalls).toEqual(['/api/email/verify', '/api/auth/end-other-sessions'])
    expect(w.text()).toContain('only this device')
  })
})
