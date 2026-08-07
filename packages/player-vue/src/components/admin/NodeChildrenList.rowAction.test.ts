/**
 * The per-row verb on the children list — added for "Assign to a class" on
 * the teachers lens, which is the staff list a school-scoped head ACTUALLY
 * lands on (nav unification redirects /schools/teachers to this node home).
 *
 * Two things worth pinning: the verb is opt-in per lens, and it is a SIBLING
 * of the row button, never nested inside it (a button inside a button is
 * invalid HTML and swallows the click).
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/org/s1', params: { id: 's1' }, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

import NodeChildrenList from './NodeChildrenList.vue'

const TEACHERS = {
  teachers: [
    { user_id: 'u-ana', name: 'Ana Jones', classes: [{ id: '6b', name: '6B' }] },
    { user_id: 'u-sam', name: 'Sam Price', classes: [] },
  ],
}

function mountList(props: { lens: string; payload: Record<string, any>; rowActionLabel?: string }) {
  return mount(NodeChildrenList, { props })
}

describe('NodeChildrenList — per-row action', () => {
  it('renders no verb when the caller passes no label', () => {
    const w = mountList({ lens: 'teachers', payload: TEACHERS })
    expect(w.findAll('.child-row-action')).toHaveLength(0)
  })

  it("renders one verb per row and emits that row's key", async () => {
    const w = mountList({ lens: 'teachers', payload: TEACHERS, rowActionLabel: 'Assign to a class' })
    const actions = w.findAll('.child-row-action')
    expect(actions).toHaveLength(2)
    await actions[1].trigger('click')
    expect(w.emitted('row-action')?.[0]).toEqual(['u-sam'])
  })

  it('keeps the verb OUTSIDE the row button', () => {
    const w = mountList({ lens: 'teachers', payload: TEACHERS, rowActionLabel: 'Assign to a class' })
    expect(w.find('.child-btn').find('.child-row-action').exists()).toBe(false)
  })
})
