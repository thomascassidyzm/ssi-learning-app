/**
 * SettingsView.vue gating logic tests (script-level, no template render —
 * matches TeachersView.test.ts's convention for <script setup> components).
 *
 * SECURITY/UX: the editable school profile fields + Billing tab are
 * admin-only — renaming the school and changing seats are school_admin
 * actions server-side (api/school/update-profile.ts / update-seats.ts), so a
 * plain teacher must see them read-only/hidden, not just fail silently on
 * save (2026-07-16 teacher-loop audit finding).
 */
import { describe, it, expect } from 'vitest'

type SectionId = 'profile' | 'locale' | 'data' | 'billing'
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'profile', label: 'School profile' },
  { id: 'locale', label: 'Localisation' },
  { id: 'data', label: 'Data & privacy' },
  { id: 'billing', label: 'Billing' },
]

function canEditSchool(isSchoolAdmin: boolean, isAdminView: boolean): boolean {
  return isSchoolAdmin && !isAdminView
}

function visibleSections(isSchoolAdmin: boolean): SectionId[] {
  return SECTIONS.filter((s) => s.id !== 'billing' || isSchoolAdmin).map((s) => s.id)
}

describe('SettingsView admin-only gating', () => {
  it('school_admin viewing their own school can edit the profile', () => {
    expect(canEditSchool(true, false)).toBe(true)
  })

  it('a plain teacher cannot edit the profile', () => {
    expect(canEditSchool(false, false)).toBe(false)
  })

  it('an ssi_admin read-only browse view cannot edit even as the school_admin persona', () => {
    expect(canEditSchool(true, true)).toBe(false)
  })

  it('Billing is hidden from a plain teacher', () => {
    expect(visibleSections(false)).toEqual(['profile', 'locale', 'data'])
  })

  it('Billing is visible to a school_admin', () => {
    expect(visibleSections(true)).toEqual(['profile', 'locale', 'data', 'billing'])
  })
})
