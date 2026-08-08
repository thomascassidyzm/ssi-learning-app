/**
 * The picker itself: pre-ticked from the truth, and a partial failure that
 * names the class and shows the server's own error string.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AssignClassesModal from './AssignClassesModal.vue'
import type { AssignableClass } from '@/composables/schools/assignTeacherClasses'

const mountOpts = { global: { stubs: { teleport: true } } }

const CLASSES: AssignableClass[] = [
  { id: '6b', class_name: '6B', isMember: true, hasActiveTeacher: true },
  { id: '7a', class_name: '7A', isMember: false, hasActiveTeacher: true },
  { id: '8c', class_name: '8C', isMember: false, hasActiveTeacher: false },
]

function open(props: Record<string, unknown> = {}) {
  return mount(AssignClassesModal, {
    props: { isOpen: true, teacherName: 'Ana', classes: CLASSES, ...props },
    ...mountOpts,
  })
}

describe('AssignClassesModal', () => {
  it('pre-ticks the classes the teacher already teaches', () => {
    const boxes = open().findAll('input[type="checkbox"]')
    expect(boxes.map(b => (b.element as HTMLInputElement).checked)).toEqual([true, false, false])
  })

  it('emits the ticked set — a move is one add and one remove', async () => {
    const w = open()
    const boxes = w.findAll('input[type="checkbox"]')
    await boxes[0].trigger('change')  // untick 6B
    await boxes[1].trigger('change')  // tick 7A
    await w.find('[data-walk="assign-classes-save"]').trigger('click')
    expect(w.emitted('confirm')?.[0][0]).toEqual(['7a'])
  })

  it('Save is inert until something actually changed', async () => {
    const w = open()
    expect((w.find('[data-walk="assign-classes-save"]').element as HTMLButtonElement).disabled).toBe(true)
    await w.findAll('input[type="checkbox"]')[1].trigger('change')
    expect((w.find('[data-walk="assign-classes-save"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('flags a class with no teacher, so the leader knows they would lead it', () => {
    expect(open().text()).toContain("no teacher yet — they'd lead it")
  })

  it('names the failed class and shows the server error verbatim on a partial save', () => {
    const w = open({
      summary: 'Partly done — 1 of 2 changes saved.',
      outcomes: [
        { classId: '6b', className: '6B', action: 'add', ok: true, error: null },
        { classId: '7a', className: '7A', action: 'add', ok: false, error: 'Not authorised for this class' },
      ],
    })
    const text = w.text()
    expect(text).toContain('Partly done')
    expect(text).toContain('7A')
    expect(text).toContain('Not authorised for this class')
    // The one that worked must not be listed as a failure.
    expect(w.findAll('.failure-row')).toHaveLength(1)
  })

  it('says why the class list is missing rather than showing an empty picker', () => {
    const w = open({ classes: [], loadError: "Couldn't load this school's classes. permission denied" })
    expect(w.text()).toContain('permission denied')
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(0)
  })
})
