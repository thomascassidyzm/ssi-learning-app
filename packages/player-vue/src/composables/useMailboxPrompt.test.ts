/**
 * The rule about when we ask a teacher to prove their mailbox, and when we
 * must never ask again.
 *
 * The three failures this exists to stop, in the order they would hurt:
 *   · a standing nag — asked again after being closed, or on a timer;
 *   · asked three times because they created three classes;
 *   · asked at all once the mailbox is proved.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { defineComponent, h, ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import {
  isMailboxUnproven,
  shouldShowMailboxPrompt,
  dismissalStorageKey,
  useMailboxPrompt,
  __resetMailboxPromptSession,
} from './useMailboxPrompt'

const possessionUnproven = { onboarded_via: 'possession' }
const possessionProved = { onboarded_via: 'possession', email_confirmed_manually: true }

describe('isMailboxUnproven', () => {
  it('is true only for a possession account that has never completed a code round trip', () => {
    expect(isMailboxUnproven(possessionUnproven)).toBe(true)
    expect(isMailboxUnproven(possessionProved)).toBe(false)
    expect(isMailboxUnproven({ onboarded_via: 'signup' })).toBe(false)
    expect(isMailboxUnproven(null)).toBe(false)
  })
})

describe('shouldShowMailboxPrompt', () => {
  const base = {
    metadata: possessionUnproven,
    dismissed: false,
    shownThisSession: false,
    momentReached: true,
  }

  it('shows at a keep-worthy moment for an unproven mailbox', () => {
    expect(shouldShowMailboxPrompt(base)).toBe(true)
  })

  it('never shows without a moment — no page load, no route change, no badge', () => {
    expect(shouldShowMailboxPrompt({ ...base, momentReached: false })).toBe(false)
  })

  it('never shows again once dismissed', () => {
    expect(shouldShowMailboxPrompt({ ...base, dismissed: true })).toBe(false)
  })

  it('shows at most once per session, however many classes are created', () => {
    expect(shouldShowMailboxPrompt({ ...base, shownThisSession: true })).toBe(false)
  })

  it('never shows once the mailbox is proved', () => {
    expect(shouldShowMailboxPrompt({ ...base, metadata: possessionProved })).toBe(false)
  })
})

function mountWithAuth(metadata: Record<string, unknown>, id = 'auth-uid-1') {
  const api: any = {}
  const Host = defineComponent({
    setup() {
      Object.assign(api, useMailboxPrompt())
      return () => h('div')
    },
  })
  const wrapper = mount(Host, {
    global: {
      provide: {
        auth: { user: ref({ id, email: 'ms.jones@school.example', user_metadata: metadata }) },
      },
    },
  })
  return { api, wrapper }
}

describe('useMailboxPrompt', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetMailboxPromptSession()
  })

  it('opens on the moment, and a dismissal is durable across a fresh session', async () => {
    const first = mountWithAuth(possessionUnproven)
    expect(first.api.isOpen.value).toBe(false)
    first.api.noteKeepWorthyMoment()
    await nextTick()
    expect(first.api.isOpen.value).toBe(true)

    first.api.dismiss()
    expect(first.api.isOpen.value).toBe(false)
    expect(localStorage.getItem(dismissalStorageKey('auth-uid-1'))).toBe('1')

    // A brand new session — the cap is gone, the dismissal is not.
    __resetMailboxPromptSession()
    const second = mountWithAuth(possessionUnproven)
    second.api.noteKeepWorthyMoment()
    await nextTick()
    expect(second.api.isOpen.value).toBe(false)
  })

  it('asks once even when three classes are created in a row', async () => {
    const { api } = mountWithAuth(possessionUnproven)
    api.noteKeepWorthyMoment()
    api.dismiss()
    api.noteKeepWorthyMoment()
    api.noteKeepWorthyMoment()
    await nextTick()
    expect(api.isOpen.value).toBe(false)
  })

  it('another teacher on the same browser is not covered by the first one dismissing it', async () => {
    const { api } = mountWithAuth(possessionUnproven, 'auth-uid-1')
    api.noteKeepWorthyMoment()
    api.dismiss()

    __resetMailboxPromptSession()
    const other = mountWithAuth(possessionUnproven, 'auth-uid-2')
    other.api.noteKeepWorthyMoment()
    await nextTick()
    expect(other.api.isOpen.value).toBe(true)
  })

  it('never opens for an account that has proved its mailbox', async () => {
    const { api } = mountWithAuth(possessionProved)
    api.noteKeepWorthyMoment()
    await nextTick()
    expect(api.isOpen.value).toBe(false)
  })
})
