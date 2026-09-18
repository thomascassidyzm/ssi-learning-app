/**
 * A superseded code is named as superseded, and Resend cools down and says
 * the consequence (Tom, 2026-09-18). Pre-fix every screen showed GoTrue's
 * "Token has expired or is invalid" and let Resend fire again at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { friendlyVerifyCodeError, resendCountdownLabel, SUPERSESSION_NOTICE, RESEND_COOLDOWN_MS } from './codeSupersession'
import { useResendCooldown } from '../composables/useResendCooldown'

describe('friendlyVerifyCodeError', () => {
  it('never shows GoTrue\'s verdict, and names supersession as the likely cause', () => {
    const msg = friendlyVerifyCodeError('Token has expired or is invalid')
    expect(msg).not.toMatch(/expired or is invalid/i)
    expect(msg).toMatch(/newest/i)
  })
  it('after a resend it says the earlier code has been replaced', () => {
    expect(friendlyVerifyCodeError('Token has expired or is invalid', { resends: 1 })).toMatch(/replaced/i)
  })
  it('a rate limit keeps its own words', () => {
    expect(friendlyVerifyCodeError('For security purposes, you can only request this after 47 seconds')).toMatch(/minute/i)
  })
  it('the notice under Resend states the consequence before the tap', () => {
    expect(SUPERSESSION_NOTICE).toMatch(/cancels/i)
    expect(resendCountdownLabel(12)).toBe('Send a fresh code in 12s')
    expect(resendCountdownLabel(0)).toBe('Send a fresh code')
  })
})

describe('useResendCooldown', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('holds Resend down for the cooldown after a send, then reopens', async () => {
    let api: ReturnType<typeof useResendCooldown> | null = null
    const Host = defineComponent({ setup() { api = useResendCooldown(); return () => h('div') } })
    mount(Host)
    expect(api!.canResend.value).toBe(true)
    api!.start()
    expect(api!.canResend.value).toBe(false)
    expect(api!.secondsLeft.value).toBe(RESEND_COOLDOWN_MS / 1000)
    await vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_MS / 2)
    expect(api!.canResend.value).toBe(false)
    await vi.advanceTimersByTimeAsync(RESEND_COOLDOWN_MS / 2 + 1000)
    expect(api!.canResend.value).toBe(true)
    api!.start()
    api!.reset()
    expect(api!.canResend.value).toBe(true)
  })
})
