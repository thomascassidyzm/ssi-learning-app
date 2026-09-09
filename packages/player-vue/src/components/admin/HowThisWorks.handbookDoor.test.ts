/**
 * The Handbook chip must open the Handbook on the surface you are standing on.
 *
 * Founder report 2026-09-09, on a phone, viewing the group "Abergavenny Fire
 * Office" from /admin/structure: "Handbook doesnt go anywhere… Handbook goes
 * to the structure page of mine." Cause: the chip pointed at /schools/handbook
 * for every non-leader persona, and memberSurfaceGuard bounces an ssi_admin
 * (admin rights, no school role) out of the whole /schools tree to
 * /admin/structure. Nothing to do with group-vs-school — it is surface.
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HowThisWorks from './HowThisWorks.vue'

const path = { value: '/' }
vi.mock('vue-router', () => ({
  useRoute: () => ({ get path() { return path.value } }),
  RouterLink: { props: ['to'], template: '<a :href="String(to)"><slot /></a>' },
}))

function doorHref(routePath: string, persona: 'admin' | 'leader', kind = 'group'): string {
  path.value = routePath
  const w = mount(HowThisWorks, {
    props: { persona, kind, nodeId: 'node-1' },
    global: { stubs: { 'router-link': { props: ['to'], template: '<a :href="String(to)"><slot /></a>' } } },
  })
  return w.find('.htw-handbook').attributes('href') || ''
}

describe('HowThisWorks — the Handbook door', () => {
  it('opens the ADMIN handbook from an admin node page (never /schools, which redirects an ssi_admin to Structure)', () => {
    expect(doorHref('/admin/groups/abergavenny', 'admin')).toBe('/admin/handbook')
  })

  it('still opens the node handbook for a leader on their own org surface', () => {
    expect(doorHref('/org/node-1', 'leader')).toBe('/org/node-1/handbook')
  })

  it('still opens the schools handbook inside the schools shell', () => {
    expect(doorHref('/schools', 'admin')).toBe('/schools/handbook')
  })
})
