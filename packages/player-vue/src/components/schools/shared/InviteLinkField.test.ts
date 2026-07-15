import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import InviteLinkField from './InviteLinkField.vue'

describe('InviteLinkField — every invite surface shows the full URL, not just a Copy button', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  it('renders the full URL as visible text', () => {
    const wrapper = mount(InviteLinkField, {
      props: { url: 'https://staging.saysomethingin.app/redeem/ABC-123' },
    })
    expect(wrapper.find('code').text()).toBe('https://staging.saysomethingin.app/redeem/ABC-123')
  })

  it('shows an optional label', () => {
    const wrapper = mount(InviteLinkField, {
      props: { url: 'https://staging.saysomethingin.app/redeem/ABC-123', label: 'Teacher invite link' },
    })
    expect(wrapper.text()).toContain('Teacher invite link')
  })

  it('copies the full URL (not a bare code) and flips to "Copied"', async () => {
    const wrapper = mount(InviteLinkField, {
      props: { url: 'https://staging.saysomethingin.app/redeem/ABC-123' },
    })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://staging.saysomethingin.app/redeem/ABC-123')
    expect(wrapper.find('button').text()).toBe('Copied')
  })

  it('disables the copy button when there is no url yet', () => {
    const wrapper = mount(InviteLinkField, { props: { url: '' } })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })
})
