/**
 * The doorbell rings once, for a reply that has sat unopened for a few hours,
 * to the admin who asked, in the thread's language — and never for a reply
 * she has already opened.
 */
import { describe, it, expect } from 'vitest'
import { repliesDue, doorbellMessage, DOORBELL_AFTER_HOURS, type DoorbellReply } from './support-doorbell'

const H = 3600_000
const now = Date.parse('2026-09-11T12:00:00.000Z')
const reply = (id: string, hoursAgo: number, extra: Partial<DoorbellReply> = {}): DoorbellReply => ({
  id, thread_id: 't1', body: 'Your staff practice is being recorded properly.', author_source: 'human', author_name: 'Tom', in_reply_to: 'q1',
  created_at: new Date(now - hoursAgo * H).toISOString(), ...extra,
})

describe('support doorbell', () => {
  it('rings only for a reply older than the window that the thread has not been opened since', () => {
    const rows = [reply('fresh', 1), reply('due', DOORBELL_AFTER_HOURS + 1), reply('opened', 5), reply('orphan', 6, { thread_id: 'nope' })]
    const threads = { t1: { last_read_at: null, language: 'eng' } }
    expect(repliesDue(rows, threads, now).map((r) => r.id)).toEqual(['due', 'opened'])
    // She opened the thread after the reply landed: no bell.
    const opened = { t1: { last_read_at: new Date(now - 2 * H).toISOString(), language: 'eng' } }
    expect(repliesDue(rows, opened, now)).toEqual([])
  })

  it('names Tom when the reply is his and SSi when it is the agent\'s, in the thread\'s language', () => {
    const tom = doorbellMessage(reply('r', 4), 'eng', 'head@ysgol.example')
    expect(tom.subject).toBe("Tom replied on your school's Support thread")
    expect(tom.to).toBe('head@ysgol.example')
    expect(tom.from).toContain('contact.saysomethingin.app')
    expect(tom.text).toContain('/schools/support')
    expect(tom.html).toContain('Your staff practice')
    const ssi = doorbellMessage(reply('r', 4, { author_source: 'agent', author_name: 'SSi' }), 'cym', 'head@ysgol.example')
    expect(ssi.subject).toBe('Mae SSi wedi ateb ar sgwrs Gymorth eich ysgol')
    expect(ssi.text).toContain('Agor y sgwrs')
  })

  it('escapes the reply body in the html', () => {
    const m = doorbellMessage(reply('r', 4, { body: '<script>alert(1)</script>' }), 'eng', 'x@y.z')
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;')
  })
})
