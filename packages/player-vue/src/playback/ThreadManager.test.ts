/**
 * ThreadManager Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createThreadManager, type ThreadManager, threadIdFromNumber, threadNumberFromId } from './ThreadManager'
import type { LegoPair } from '@ssi/core'

describe('ThreadManager', () => {
  let manager: ThreadManager

  const createMockLego = (id: string): LegoPair => ({
    id,
    type: 'A',
    new: true,
    lego: { known: `known-${id}`, target: `target-${id}` },
    audioRefs: {
      known: { id: `audio-known-${id}`, url: '', duration_ms: 1000 },
      target: {
        voice1: { id: `audio-target1-${id}`, url: '', duration_ms: 1500 },
        voice2: { id: `audio-target2-${id}`, url: '', duration_ms: 1500 },
      },
    },
  })

  beforeEach(() => {
    manager = createThreadManager()
  })

  describe('initialization', () => {
    it('should start with thread A active', () => {
      expect(manager.getActiveThread()).toBe('A')
    })

    it('should card-deal LEGOs across threads', () => {
      const legos = [
        createMockLego('L1'),
        createMockLego('L2'),
        createMockLego('L3'),
        createMockLego('L4'),
        createMockLego('L5'),
        createMockLego('L6'),
      ]

      manager.initialize(legos, 'test-course')

      // Check progress exists for all LEGOs
      expect(manager.getProgress('L1')).toBeDefined()
      expect(manager.getProgress('L2')).toBeDefined()
      expect(manager.getProgress('L3')).toBeDefined()
      expect(manager.getProgress('L4')).toBeDefined()
      expect(manager.getProgress('L5')).toBeDefined()
      expect(manager.getProgress('L6')).toBeDefined()

      // Check thread assignment (via thread_id in progress)
      expect(manager.getProgress('L1')?.thread_id).toBe(1) // A
      expect(manager.getProgress('L2')?.thread_id).toBe(2) // B
      expect(manager.getProgress('L3')?.thread_id).toBe(3) // C
      expect(manager.getProgress('L4')?.thread_id).toBe(1) // A
      expect(manager.getProgress('L5')?.thread_id).toBe(2) // B
      expect(manager.getProgress('L6')?.thread_id).toBe(3) // C
    })
  })

  describe('thread rotation', () => {
    it('should rotate A → B → C → A', () => {
      expect(manager.getActiveThread()).toBe('A')

      manager.advanceThread()
      expect(manager.getActiveThread()).toBe('B')

      manager.advanceThread()
      expect(manager.getActiveThread()).toBe('C')

      manager.advanceThread()
      expect(manager.getActiveThread()).toBe('A')
    })
  })

  describe('progress tracking', () => {
    it('should create default progress for new LEGOs', () => {
      const legos = [createMockLego('L1')]
      manager.initialize(legos, 'test-course')

      const progress = manager.getProgress('L1')
      expect(progress).toBeDefined()
      expect(progress?.fibonacci_position).toBe(0)
      expect(progress?.skip_number).toBe(1)
      expect(progress?.introduction_complete).toBe(false)
    })

    it('should update progress on practice', () => {
      const legos = [createMockLego('L1')]
      manager.initialize(legos, 'test-course')

      const updated = manager.recordPractice('L1', true)

      expect(updated?.reps_completed).toBe(1)
      expect(updated?.fibonacci_position).toBe(1)
    })

    it('should decrease fibonacci position on failure', () => {
      const legos = [createMockLego('L1')]
      manager.initialize(legos, 'test-course')

      // Advance a few times
      manager.recordPractice('L1', true)
      manager.recordPractice('L1', true)
      manager.recordPractice('L1', true)

      const beforeFail = manager.getProgress('L1')
      expect(beforeFail?.fibonacci_position).toBe(3)

      // Fail
      const afterFail = manager.recordPractice('L1', false)
      expect(afterFail?.fibonacci_position).toBe(1) // Goes back 2 positions
    })
  })

  describe('spaced repetition', () => {
    it('should return items ready for spaced rep when properly set up via serialization', () => {
      const legos = [createMockLego('L1'), createMockLego('L2'), createMockLego('L3')]
      manager.initialize(legos, 'test-course')

      // Use serialization/restore to set up the progress state
      const serialized = manager.serialize()

      // Modify the serialized state to mark L1 as introduced with skip=0
      const threadA = serialized.threads['A']
      if (threadA) {
        const l1Progress = threadA.progress.find(p => p.legoId === 'L1')
        if (l1Progress) {
          l1Progress.progress.introduction_complete = true
          l1Progress.progress.skip_number = 0
        }
      }

      // Restore the modified state
      manager.restore(serialized, legos, 'test-course')

      const spacedRep = manager.getSpacedRepItems('A', 5)
      expect(spacedRep.length).toBe(1)
      expect(spacedRep[0].id).toBe('L1')
    })

    it('should not return LEGOs that are not introduced', () => {
      const legos = [createMockLego('L1')]
      manager.initialize(legos, 'test-course')

      // Default: not introduced, so should not appear in spaced rep
      const spacedRep = manager.getSpacedRepItems('A', 5)
      expect(spacedRep.length).toBe(0)
    })
  })

  describe('serialization', () => {
    it('should serialize and restore state', () => {
      const legos = [
        createMockLego('L1'),
        createMockLego('L2'),
        createMockLego('L3'),
      ]
      manager.initialize(legos, 'test-course')

      // Make some changes
      manager.advanceThread()
      manager.recordPractice('L1', true)

      // Serialize
      const serialized = manager.serialize()
      expect(serialized.activeThread).toBe('B')

      // Create new manager and restore
      const newManager = createThreadManager()
      newManager.restore(serialized, legos, 'test-course')

      expect(newManager.getActiveThread()).toBe('B')
      expect(newManager.getProgress('L1')?.reps_completed).toBe(1)
    })
  })

  describe('skip number decrement', () => {
    it('should decrement skip numbers for introduced LEGOs via restore', () => {
      const legos = [createMockLego('L1')]
      manager.initialize(legos, 'test-course')

      // Use serialization/restore to set up state
      const serialized = manager.serialize()
      const threadA = serialized.threads['A']
      if (threadA) {
        const l1Progress = threadA.progress.find(p => p.legoId === 'L1')
        if (l1Progress) {
          l1Progress.progress.introduction_complete = true
          l1Progress.progress.skip_number = 3
        }
      }
      manager.restore(serialized, legos, 'test-course')

      manager.decrementSkipNumbers()

      expect(manager.getProgress('L1')?.skip_number).toBe(2)
    })

    it('should not decrement skip_number for non-introduced LEGOs', () => {
      const legos = [createMockLego('L1')]
      manager.initialize(legos, 'test-course')

      // Default: skip_number is 1, but introduction_complete is false
      // So decrement should not happen
      const before = manager.getProgress('L1')?.skip_number
      manager.decrementSkipNumbers()
      const after = manager.getProgress('L1')?.skip_number

      expect(before).toBe(after)
    })
  })
})

describe('Thread ID utilities', () => {
  it('should convert thread number to ID', () => {
    expect(threadIdFromNumber(1)).toBe('A')
    expect(threadIdFromNumber(2)).toBe('B')
    expect(threadIdFromNumber(3)).toBe('C')
  })

  it('should convert thread ID to number', () => {
    expect(threadNumberFromId('A')).toBe(1)
    expect(threadNumberFromId('B')).toBe(2)
    expect(threadNumberFromId('C')).toBe(3)
  })
})
