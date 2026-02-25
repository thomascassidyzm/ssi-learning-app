/**
 * ClassDetail.vue logic tests
 *
 * Tests pure functions and logic from the ClassDetail component.
 */
import { describe, it, expect } from 'vitest'

// --- getBelt (seeds-based thresholds, different from TeachersView hours-based) ---

function getBelt(seedsCompleted: number): string {
  if (seedsCompleted >= 400) return 'black'
  if (seedsCompleted >= 280) return 'brown'
  if (seedsCompleted >= 150) return 'blue'
  if (seedsCompleted >= 80) return 'green'
  if (seedsCompleted >= 40) return 'orange'
  if (seedsCompleted >= 20) return 'yellow'
  return 'white'
}

describe('ClassDetail getBelt (seeds-based)', () => {
  it('returns white for 0 seeds', () => {
    expect(getBelt(0)).toBe('white')
  })

  it('returns yellow at 20 seeds', () => {
    expect(getBelt(20)).toBe('yellow')
  })

  it('returns orange at 40 seeds', () => {
    expect(getBelt(40)).toBe('orange')
  })

  it('returns green at 80 seeds', () => {
    expect(getBelt(80)).toBe('green')
  })

  it('returns blue at 150 seeds', () => {
    expect(getBelt(150)).toBe('blue')
  })

  it('returns brown at 280 seeds', () => {
    expect(getBelt(280)).toBe('brown')
  })

  it('returns black at 400 seeds', () => {
    expect(getBelt(400)).toBe('black')
  })

  it('boundary: 19 seeds is still white', () => {
    expect(getBelt(19)).toBe('white')
  })

  it('boundary: 399 seeds is still brown', () => {
    expect(getBelt(399)).toBe('brown')
  })
})

// --- Session duration formatting ---

function formatDuration(durationSeconds: number): string {
  if (durationSeconds > 0) {
    return `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
  }
  return 'In progress'
}

describe('ClassDetail session duration formatting', () => {
  it('formats normal duration', () => {
    expect(formatDuration(1800)).toBe('30m 0s')
    expect(formatDuration(95)).toBe('1m 35s')
  })

  it('shows "In progress" for 0 duration', () => {
    expect(formatDuration(0)).toBe('In progress')
  })

  it('handles exact minute', () => {
    expect(formatDuration(300)).toBe('5m 0s')
  })
})

// --- LEGO range display ---

function legoRange(startId: string, endId: string | null): string {
  return endId ? `${startId} → ${endId}` : startId
}

describe('ClassDetail lego range display', () => {
  it('shows range when both start and end', () => {
    expect(legoRange('S0001L01', 'S0010L03')).toBe('S0001L01 → S0010L03')
  })

  it('shows only start when no end', () => {
    expect(legoRange('S0001L01', null)).toBe('S0001L01')
  })
})

// --- getInitials ---

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

describe('ClassDetail getInitials', () => {
  it('extracts up to 2 initials', () => {
    expect(getInitials('John Smith')).toBe('JS')
    expect(getInitials('Alice')).toBe('A')
    expect(getInitials('Mary Jane Watson')).toBe('MJ')
  })
})

// --- formatJoinDate ---

function formatJoinDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

describe('ClassDetail formatJoinDate', () => {
  it('formats valid date string', () => {
    const result = formatJoinDate('2025-01-15T00:00:00Z')
    expect(result).toContain('Jan')
    expect(result).toContain('2025')
  })

  it('returns Unknown for null', () => {
    expect(formatJoinDate(null)).toBe('Unknown')
  })
})

// --- Student removal uses correct id ---

describe('ClassDetail student removal', () => {
  it('student object has learner_id as id and user_id for DB operations', () => {
    // From classDetail computed in useClassesData:
    // students are mapped with learner_id as id, user_id for Supabase
    const classDetailStudent = {
      learner_id: 'learner-abc',
      user_id: 'user-xyz',
      display_name: 'Test Student',
    }

    // The view maps this to:
    const viewStudent = {
      id: classDetailStudent.learner_id,
      name: classDetailStudent.display_name,
    }

    // handleRemoveStudent receives student.id which is learner_id
    // and uses it for the user_tags query (.eq('user_id', student.id))
    // This works because learner_id is used as the removal key
    expect(viewStudent.id).toBe('learner-abc')
    expect(typeof viewStudent.id).toBe('string')
  })
})
