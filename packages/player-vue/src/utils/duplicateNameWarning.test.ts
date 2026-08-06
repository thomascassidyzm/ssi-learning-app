import { describe, it, expect } from 'vitest'
import { formatCreatedOn, duplicateWarningMessage, readDuplicateWarning } from './duplicateNameWarning'

describe('formatCreatedOn', () => {
  it('is British and plain', () => {
    expect(formatCreatedOn('2026-08-05T10:00:00Z')).toBe('5 August 2026')
  })
  it('is empty rather than wrong when the date is missing or junk', () => {
    expect(formatCreatedOn(null)).toBe('')
    expect(formatCreatedOn('not a date')).toBe('')
  })
})

describe('duplicateWarningMessage', () => {
  it('names the org and when it was made, and says what will happen', () => {
    expect(duplicateWarningMessage([{ name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z' }])).toBe(
      'There\'s already an organisation called "Deborah Testing", created on 5 August 2026. Creating this one will give you two with the same name.',
    )
  })

  it('drops the date clause rather than saying "created on "', () => {
    expect(duplicateWarningMessage([{ name: 'Deborah Testing' }])).toBe(
      'There\'s already an organisation called "Deborah Testing". Creating this one will give you two with the same name.',
    )
  })

  it('says group for a sub-group collision', () => {
    expect(duplicateWarningMessage([{ name: 'Year 7' }], 'group')).toContain('a group called "Year 7"')
  })
})

describe('readDuplicateWarning', () => {
  const body = { error: 'x', code: 'duplicate_name', duplicates: [{ name: 'Deborah Testing', created_at: '2026-08-05T10:00:00Z' }] }

  it('recognises the duplicate-name 409', () => {
    const w = readDuplicateWarning(409, body)
    expect(w?.message).toContain('Deborah Testing')
    expect(w?.duplicates).toHaveLength(1)
  })

  it('IGNORES the one-org-per-leader 409 — that is a real dead end and keeps its own handling', () => {
    expect(readDuplicateWarning(409, { error: 'You already lead a group — one organisation per leader for now' })).toBeNull()
  })

  it('ignores every non-409 and every unparseable body', () => {
    expect(readDuplicateWarning(201, body)).toBeNull()
    expect(readDuplicateWarning(500, null)).toBeNull()
    expect(readDuplicateWarning(409, {})).toBeNull()
  })

  it('survives a 409 with the code but no duplicates array', () => {
    expect(readDuplicateWarning(409, { code: 'duplicate_name' })?.duplicates).toEqual([])
  })
})
