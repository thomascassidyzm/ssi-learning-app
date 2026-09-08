// The ask loop's page-side helpers (job #386).
import { describe, it, expect } from 'vitest'
import { questionDay, answeringEntryId } from './handbookQuestions'

describe('questionDay', () => {
  it('says the day first, the British way, whatever Intl thinks of the locale', () => {
    expect(questionDay('2026-09-08T09:12:00Z')).toBe('8 September')
    expect(questionDay('2026-09-08T09:12:00Z', 'eng')).toBe('8 September')
    expect(questionDay('2026-03-14T09:12:00Z', 'not-a-locale-!!')).toBe('14 March')
  })
  it('is blank for nothing or nonsense', () => {
    expect(questionDay(null)).toBe('')
    expect(questionDay('yesterday-ish')).toBe('')
  })
})

describe('answeringEntryId', () => {
  it('links a duplicate to the entry that matched, and an in-page question to the entry it became', () => {
    expect(answeringEntryId({ status: 'duplicate', matched_entry_id: 'a', entry_id: null })).toBe('a')
    expect(answeringEntryId({ status: 'in_page', matched_entry_id: null, entry_id: 'b' })).toBe('b')
  })
  it('links nothing while a question is new, answered only in the database, or declined', () => {
    for (const status of ['new', 'answered', 'declined'] as const) {
      expect(answeringEntryId({ status, matched_entry_id: 'a', entry_id: 'b' })).toBe(null)
    }
  })
})
