import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// FOUNDER RULING (demo pass 2026-07-31): the teacher dashboard's
// "+ Create class" / "Create your first class" buttons open the Create New
// Class modal DIRECTLY — no hop to My Classes first. The old buttons were
// router-links to /schools/classes (some with ?create=1), which rendered a
// second screen whose own button opened the modal. This is a SOURCE PIN on
// the template: a create CTA must never regress to a navigation.
const src = readFileSync(join(import.meta.dirname, 'DashboardView.vue'), 'utf8')

describe('DashboardView: create-class opens the modal in place (no two-hop)', () => {
  it('no create CTA navigates to /schools/classes any more', () => {
    expect(src).not.toContain('to="/schools/classes?create=1"')
    expect(src).not.toContain('to="/schools/classes"')
  })

  it('the create flow is mounted in this view — modal, created-modal and handler', () => {
    expect(src).toContain('<CreateClassModal')
    expect(src).toContain('<ClassCreatedModal')
    expect(src).toContain('@create="handleCreateClass"')
  })

  it('every create CTA is a button that opens the modal', () => {
    const openers = src.match(/@click="isCreateModalOpen = true"/g) || []
    // header + 2 teacher empty states + legacy admin header + legacy admin empty row
    expect(openers.length).toBe(5)
  })
})
