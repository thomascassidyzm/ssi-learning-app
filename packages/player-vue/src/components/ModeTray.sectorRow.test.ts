// The sector row in the mode tray.
//
// A sector walk runs ALONGSIDE the core course from the start — that immediacy
// is the whole point — so the way in sits in the tray a learner already opens
// mid-session, between Listening and Offline. The label hands off to the
// full-screen picker exactly as Offline hands off to the depth picker: emit,
// then close the tray, because a tray left open paints over a body-teleported
// dialog.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ModeTray from './ModeTray.vue'

describe('ModeTray sector row', () => {
  let mounted: ReturnType<typeof mount> | null = null

  afterEach(() => {
    mounted?.unmount()
    mounted = null
    document.body.innerHTML = ''
  })

  const openTray = async (props: Record<string, unknown> = {}) => {
    const wrapper = mount(ModeTray, { props, attachTo: document.body })
    mounted = wrapper
    await wrapper.get('.mode-trigger').trigger('click')
    return wrapper
  }

  it('renders the sector row', async () => {
    const wrapper = await openTray()
    const row = wrapper.get('.tray-item-sector')
    expect(row.text()).toContain('For your work')
  })

  it('sits between the listening row and the offline row', async () => {
    const wrapper = await openTray()
    const names = wrapper.findAll('.tray-name').map(n => n.text())
    expect(names.indexOf('For your work')).toBeGreaterThan(names.indexOf('Listening mode'))
    expect(names.indexOf('For your work')).toBeLessThan(names.indexOf('Offline mode'))
  })

  it('opens the picker and closes the tray on the label tap', async () => {
    const wrapper = await openTray()
    await wrapper.get('.tray-item-sector .tray-item-main').trigger('click')
    expect(wrapper.emitted('openSector')).toHaveLength(1)
    expect(wrapper.find('.mode-tray').exists()).toBe(false)
  })

  it('names the chosen walk and role in the desc once a thread exists', async () => {
    const wrapper = await openTray({
      hasSectorThread: true,
      isSectorActive: true,
      sectorDesc: 'Health · General',
    })
    expect(wrapper.get('.tray-item-sector .tray-desc').text()).toBe('Health · General')
    expect(wrapper.get('.tray-item-sector .tray-toggle').classes()).toContain('on')
  })

  it('parks the thread from the toggle when one exists', async () => {
    const wrapper = await openTray({ hasSectorThread: true, isSectorActive: true })
    await wrapper.get('.tray-item-sector .tray-toggle-btn').trigger('click')
    expect(wrapper.emitted('toggleSector')).toHaveLength(1)
    expect(wrapper.emitted('openSector')).toBeUndefined()
  })

  // Nothing to park yet, so the toggle is just another way into the picker.
  it('the toggle opens the picker when no walk has been chosen', async () => {
    const wrapper = await openTray()
    await wrapper.get('.tray-item-sector .tray-toggle-btn').trigger('click')
    expect(wrapper.emitted('openSector')).toHaveLength(1)
    expect(wrapper.emitted('toggleSector')).toBeUndefined()
  })
})
