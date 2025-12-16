/**
 * Tests for MasteryStateMachine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MasteryStateMachine, createMasteryStateMachine } from './MasteryStateMachine';
import type { MasteryState, LegoMasteryState } from './types';

describe('MasteryStateMachine', () => {
  let machine: MasteryStateMachine;

  beforeEach(() => {
    machine = new MasteryStateMachine();
  });

  describe('initialization', () => {
    it('should create with default config', () => {
      const config = machine.getConfig();
      expect(config.advancement_threshold).toBe(3);
      expect(config.fast_track_threshold).toBe(5);
    });

    it('should accept custom config', () => {
      const custom = new MasteryStateMachine({
        advancement_threshold: 5,
        fast_track_threshold: 7,
      });
      const config = custom.getConfig();
      expect(config.advancement_threshold).toBe(5);
      expect(config.fast_track_threshold).toBe(7);
    });

    it('should create via factory function', () => {
      const m = createMasteryStateMachine({ advancement_threshold: 4 });
      expect(m.getConfig().advancement_threshold).toBe(4);
    });
  });

  describe('getState', () => {
    it('should create initial state for new LEGO', () => {
      const state = machine.getState('L001');

      expect(state.lego_id).toBe('L001');
      expect(state.current_state).toBe('acquisition');
      expect(state.consecutive_smooth).toBe(0);
      expect(state.consecutive_fast).toBe(0);
      expect(state.discontinuity_count).toBe(0);
      expect(state.last_discontinuity_at).toBeNull();
      expect(state.created_at).toBeInstanceOf(Date);
      expect(state.updated_at).toBeInstanceOf(Date);
    });

    it('should return same state on subsequent calls', () => {
      const state1 = machine.getState('L001');
      const state2 = machine.getState('L001');
      expect(state1).toBe(state2);
    });
  });

  describe('getTypicalSkip', () => {
    it('should return correct skip values for each state', () => {
      const lego = 'L001';

      // acquisition
      expect(machine.getTypicalSkip(lego)).toBe(1);

      // Advance to consolidating
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      expect(machine.getState(lego).current_state).toBe('consolidating');
      expect(machine.getTypicalSkip(lego)).toBe(3);

      // Advance to confident
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      expect(machine.getState(lego).current_state).toBe('confident');
      expect(machine.getTypicalSkip(lego)).toBe(8);

      // Advance to mastered
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      expect(machine.getState(lego).current_state).toBe('mastered');
      expect(machine.getTypicalSkip(lego)).toBe(21);
    });
  });

  describe('recordSmooth', () => {
    it('should increment consecutive_smooth', () => {
      const lego = 'L001';
      machine.recordSmooth(lego, false);

      const state = machine.getState(lego);
      expect(state.consecutive_smooth).toBe(1);
    });

    it('should increment consecutive_fast when wasFast=true', () => {
      const lego = 'L001';
      machine.recordSmooth(lego, true);

      const state = machine.getState(lego);
      expect(state.consecutive_smooth).toBe(1);
      expect(state.consecutive_fast).toBe(1);
    });

    it('should reset consecutive_fast when wasFast=false', () => {
      // Use higher threshold so we can test counter behavior without triggering advancement
      const customMachine = new MasteryStateMachine({ advancement_threshold: 5 });
      const lego = 'L001';
      customMachine.recordSmooth(lego, true);
      customMachine.recordSmooth(lego, true);
      expect(customMachine.getState(lego).consecutive_fast).toBe(2);

      customMachine.recordSmooth(lego, false);
      expect(customMachine.getState(lego).consecutive_fast).toBe(0);
      expect(customMachine.getState(lego).consecutive_smooth).toBe(3);
    });

    it('should advance state after advancement_threshold smooth responses', () => {
      const lego = 'L001';

      // Default threshold is 3
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      expect(machine.getState(lego).current_state).toBe('acquisition');

      const transition = machine.recordSmooth(lego, false);
      expect(transition).not.toBeNull();
      expect(transition!.from_state).toBe('acquisition');
      expect(transition!.to_state).toBe('consolidating');
      expect(transition!.reason).toBe('advancement');
      expect(machine.getState(lego).current_state).toBe('consolidating');
    });

    it('should reset counters after advancement', () => {
      const lego = 'L001';

      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);

      const state = machine.getState(lego);
      expect(state.consecutive_smooth).toBe(0);
      expect(state.consecutive_fast).toBe(0);
    });

    it('should fast-track after fast_track_threshold', () => {
      // Use custom config where fast_track_threshold < advancement_threshold
      // This allows fast-track to trigger before normal advancement
      const customMachine = new MasteryStateMachine({
        advancement_threshold: 6,
        fast_track_threshold: 5,
      });
      const lego = 'L001';

      // 4 fast responses - not yet at threshold
      for (let i = 0; i < 4; i++) {
        customMachine.recordSmooth(lego, true);
      }
      expect(customMachine.getState(lego).current_state).toBe('acquisition');

      // 5th fast response triggers fast-track
      const transition = customMachine.recordSmooth(lego, true);
      expect(transition).not.toBeNull();
      expect(transition!.from_state).toBe('acquisition');
      expect(transition!.to_state).toBe('confident'); // Skipped consolidating
      expect(transition!.reason).toBe('fast_track');
    });

    it('should not advance beyond mastered', () => {
      const lego = 'L001';

      // Advance to mastered
      for (let i = 0; i < 9; i++) {
        machine.recordSmooth(lego, false);
      }
      expect(machine.getState(lego).current_state).toBe('mastered');

      // Try to advance further
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      expect(machine.getState(lego).current_state).toBe('mastered');
    });

    it('should update updated_at timestamp', () => {
      const lego = 'L001';
      const before = new Date();
      machine.recordSmooth(lego, false);
      const after = new Date();

      const state = machine.getState(lego);
      expect(state.updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(state.updated_at.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('recordDiscontinuity', () => {
    it('should increment discontinuity_count', () => {
      const lego = 'L001';
      machine.recordDiscontinuity(lego, 'mild');

      const state = machine.getState(lego);
      expect(state.discontinuity_count).toBe(1);
    });

    it('should update last_discontinuity_at', () => {
      const lego = 'L001';
      const before = new Date();
      machine.recordDiscontinuity(lego, 'mild');
      const after = new Date();

      const state = machine.getState(lego);
      expect(state.last_discontinuity_at).not.toBeNull();
      expect(state.last_discontinuity_at!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(state.last_discontinuity_at!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    describe('mild severity', () => {
      it('should not change state', () => {
        const lego = 'L001';
        machine.recordDiscontinuity(lego, 'mild');

        const state = machine.getState(lego);
        expect(state.current_state).toBe('acquisition');
      });

      it('should not reset counters', () => {
        const lego = 'L001';
        machine.recordSmooth(lego, true);
        machine.recordSmooth(lego, true);

        machine.recordDiscontinuity(lego, 'mild');

        const state = machine.getState(lego);
        expect(state.consecutive_smooth).toBe(2);
        expect(state.consecutive_fast).toBe(2);
      });

      it('should not return a transition', () => {
        const lego = 'L001';
        const transition = machine.recordDiscontinuity(lego, 'mild');
        expect(transition).toBeNull();
      });
    });

    describe('moderate severity', () => {
      it('should not regress state', () => {
        const lego = 'L001';
        // Advance to consolidating
        for (let i = 0; i < 3; i++) {
          machine.recordSmooth(lego, false);
        }
        expect(machine.getState(lego).current_state).toBe('consolidating');

        machine.recordDiscontinuity(lego, 'moderate');
        expect(machine.getState(lego).current_state).toBe('consolidating');
      });

      it('should reset consecutive counters', () => {
        const lego = 'L001';
        machine.recordSmooth(lego, true);
        machine.recordSmooth(lego, true);

        machine.recordDiscontinuity(lego, 'moderate');

        const state = machine.getState(lego);
        expect(state.consecutive_smooth).toBe(0);
        expect(state.consecutive_fast).toBe(0);
      });

      it('should return hold transition', () => {
        const lego = 'L001';
        const transition = machine.recordDiscontinuity(lego, 'moderate');

        expect(transition).not.toBeNull();
        expect(transition!.from_state).toBe('acquisition');
        expect(transition!.to_state).toBe('acquisition');
        expect(transition!.reason).toBe('hold');
      });
    });

    describe('severe severity', () => {
      it('should regress state by one', () => {
        const lego = 'L001';

        // Advance to confident
        for (let i = 0; i < 6; i++) {
          machine.recordSmooth(lego, false);
        }
        expect(machine.getState(lego).current_state).toBe('confident');

        const transition = machine.recordDiscontinuity(lego, 'severe');

        expect(transition).not.toBeNull();
        expect(transition!.from_state).toBe('confident');
        expect(transition!.to_state).toBe('consolidating');
        expect(transition!.reason).toBe('regression');
        expect(machine.getState(lego).current_state).toBe('consolidating');
      });

      it('should not regress below acquisition', () => {
        const lego = 'L001';
        machine.recordDiscontinuity(lego, 'severe');

        const state = machine.getState(lego);
        expect(state.current_state).toBe('acquisition');
      });

      it('should reset consecutive counters', () => {
        const lego = 'L001';
        machine.recordSmooth(lego, true);
        machine.recordSmooth(lego, true);

        machine.recordDiscontinuity(lego, 'severe');

        const state = machine.getState(lego);
        expect(state.consecutive_smooth).toBe(0);
        expect(state.consecutive_fast).toBe(0);
      });
    });
  });

  describe('getAllStates', () => {
    it('should return all LEGO states', () => {
      machine.getState('L001');
      machine.getState('L002');
      machine.getState('L003');

      const states = machine.getAllStates();
      expect(states).toHaveLength(3);

      const ids = states.map(s => s.lego_id).sort();
      expect(ids).toEqual(['L001', 'L002', 'L003']);
    });

    it('should return empty array when no states', () => {
      const states = machine.getAllStates();
      expect(states).toEqual([]);
    });
  });

  describe('loadStates', () => {
    it('should load states from persistence', () => {
      const states: LegoMasteryState[] = [
        {
          lego_id: 'L001',
          current_state: 'consolidating',
          consecutive_smooth: 2,
          consecutive_fast: 1,
          discontinuity_count: 3,
          last_discontinuity_at: new Date('2025-01-01'),
          created_at: new Date('2024-12-01'),
          updated_at: new Date('2025-01-01'),
        },
        {
          lego_id: 'L002',
          current_state: 'mastered',
          consecutive_smooth: 0,
          consecutive_fast: 0,
          discontinuity_count: 1,
          last_discontinuity_at: null,
          created_at: new Date('2024-12-01'),
          updated_at: new Date('2024-12-15'),
        },
      ];

      machine.loadStates(states);

      const loaded1 = machine.getState('L001');
      expect(loaded1.current_state).toBe('consolidating');
      expect(loaded1.consecutive_smooth).toBe(2);
      expect(loaded1.consecutive_fast).toBe(1);
      expect(loaded1.discontinuity_count).toBe(3);

      const loaded2 = machine.getState('L002');
      expect(loaded2.current_state).toBe('mastered');
      expect(loaded2.discontinuity_count).toBe(1);
    });

    it('should convert date strings to Date objects', () => {
      const states: any[] = [
        {
          lego_id: 'L001',
          current_state: 'acquisition',
          consecutive_smooth: 0,
          consecutive_fast: 0,
          discontinuity_count: 0,
          last_discontinuity_at: '2025-01-01T00:00:00Z',
          created_at: '2024-12-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      machine.loadStates(states);

      const state = machine.getState('L001');
      expect(state.created_at).toBeInstanceOf(Date);
      expect(state.updated_at).toBeInstanceOf(Date);
      expect(state.last_discontinuity_at).toBeInstanceOf(Date);
    });

    it('should clear existing states before loading', () => {
      machine.getState('L999');
      expect(machine.getAllStates()).toHaveLength(1);

      machine.loadStates([
        {
          lego_id: 'L001',
          current_state: 'acquisition',
          consecutive_smooth: 0,
          consecutive_fast: 0,
          discontinuity_count: 0,
          last_discontinuity_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const states = machine.getAllStates();
      expect(states).toHaveLength(1);
      expect(states[0].lego_id).toBe('L001');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      machine.updateConfig({ advancement_threshold: 5 });
      expect(machine.getConfig().advancement_threshold).toBe(5);
      expect(machine.getConfig().fast_track_threshold).toBe(5); // Unchanged
    });

    it('should affect subsequent state transitions', () => {
      machine.updateConfig({ advancement_threshold: 2 });

      const lego = 'L001';
      machine.recordSmooth(lego, false);
      expect(machine.getState(lego).current_state).toBe('acquisition');

      machine.recordSmooth(lego, false);
      expect(machine.getState(lego).current_state).toBe('consolidating');
    });
  });

  describe('clear', () => {
    it('should remove all states', () => {
      machine.getState('L001');
      machine.getState('L002');
      expect(machine.getAllStates()).toHaveLength(2);

      machine.clear();
      expect(machine.getAllStates()).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      // Create LEGOs in different states
      machine.getState('L001'); // acquisition
      machine.recordSmooth('L002', false);
      machine.recordSmooth('L002', false);
      machine.recordSmooth('L002', false); // consolidating

      machine.recordDiscontinuity('L001', 'mild');
      machine.recordDiscontinuity('L001', 'mild');
      machine.recordDiscontinuity('L002', 'mild');

      machine.recordSmooth('L001', false);

      const stats = machine.getStats();

      expect(stats.total).toBe(2);
      expect(stats.by_state.acquisition).toBe(1);
      expect(stats.by_state.consolidating).toBe(1);
      expect(stats.by_state.confident).toBe(0);
      expect(stats.by_state.mastered).toBe(0);
      expect(stats.avg_consecutive_smooth).toBe(0.5); // (1 + 0) / 2
      expect(stats.avg_discontinuity_count).toBe(1.5); // (2 + 1) / 2
    });

    it('should handle empty state', () => {
      const stats = machine.getStats();

      expect(stats.total).toBe(0);
      expect(stats.avg_consecutive_smooth).toBe(0);
      expect(stats.avg_discontinuity_count).toBe(0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete progression: acquisition → mastered', () => {
      const lego = 'L001';

      // acquisition → consolidating
      for (let i = 0; i < 3; i++) {
        machine.recordSmooth(lego, false);
      }
      expect(machine.getState(lego).current_state).toBe('consolidating');

      // consolidating → confident
      for (let i = 0; i < 3; i++) {
        machine.recordSmooth(lego, false);
      }
      expect(machine.getState(lego).current_state).toBe('confident');

      // confident → mastered
      for (let i = 0; i < 3; i++) {
        machine.recordSmooth(lego, false);
      }
      expect(machine.getState(lego).current_state).toBe('mastered');
    });

    it('should handle regression from confident to acquisition', () => {
      const lego = 'L001';

      // Advance to confident
      for (let i = 0; i < 6; i++) {
        machine.recordSmooth(lego, false);
      }
      expect(machine.getState(lego).current_state).toBe('confident');

      // Severe discontinuity: confident → consolidating
      machine.recordDiscontinuity(lego, 'severe');
      expect(machine.getState(lego).current_state).toBe('consolidating');

      // Another severe: consolidating → acquisition
      machine.recordDiscontinuity(lego, 'severe');
      expect(machine.getState(lego).current_state).toBe('acquisition');

      // Cannot regress below acquisition
      machine.recordDiscontinuity(lego, 'severe');
      expect(machine.getState(lego).current_state).toBe('acquisition');
    });

    it('should handle mixed smooth/discontinuity pattern', () => {
      const lego = 'L001';

      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      machine.recordDiscontinuity(lego, 'moderate'); // Resets counters

      expect(machine.getState(lego).consecutive_smooth).toBe(0);
      expect(machine.getState(lego).current_state).toBe('acquisition');

      // Must build up again
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      machine.recordSmooth(lego, false);
      expect(machine.getState(lego).current_state).toBe('consolidating');
    });

    it('should handle fast-track from mastered (stays mastered)', () => {
      // Use custom config where fast_track_threshold < advancement_threshold
      const customMachine = new MasteryStateMachine({
        advancement_threshold: 6,
        fast_track_threshold: 5,
      });
      const lego = 'L001';

      // Get to confident via fast-track (skips consolidating)
      for (let i = 0; i < 5; i++) {
        customMachine.recordSmooth(lego, true);
      }
      expect(customMachine.getState(lego).current_state).toBe('confident'); // Skipped consolidating

      // Get to mastered via another fast-track
      for (let i = 0; i < 5; i++) {
        customMachine.recordSmooth(lego, true);
      }
      expect(customMachine.getState(lego).current_state).toBe('mastered');

      // Further fast responses don't change state
      for (let i = 0; i < 5; i++) {
        customMachine.recordSmooth(lego, true);
      }
      expect(customMachine.getState(lego).current_state).toBe('mastered');
    });
  });
});
