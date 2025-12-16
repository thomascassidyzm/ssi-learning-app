/**
 * Example usage of MasteryStateMachine
 *
 * This demonstrates how to track mastery progression for LEGOs
 * based on smooth/fast responses and discontinuities.
 */

import { MasteryStateMachine } from './MasteryStateMachine';
import type { MasteryState } from './types';

// ============================================
// Basic Usage
// ============================================

function basicExample() {
  // Create a new mastery state machine
  const machine = new MasteryStateMachine({
    advancement_threshold: 3,    // Advance after 3 consecutive smooth responses
    fast_track_threshold: 5,     // Skip a state after 5 consecutive fast responses
  });

  const legoId = 'S0003L01';

  // Initial state is 'acquisition' with typical_skip=1
  console.log('Initial state:', machine.getState(legoId).current_state);
  console.log('Typical skip:', machine.getTypicalSkip(legoId));

  // Record successful smooth responses (no discontinuity)
  machine.recordSmooth(legoId, false); // Not fast
  machine.recordSmooth(legoId, false);
  const transition = machine.recordSmooth(legoId, false); // 3rd smooth = advance!

  if (transition) {
    console.log(`State changed: ${transition.from_state} → ${transition.to_state}`);
    console.log(`Reason: ${transition.reason}`);
  }

  // Now in 'consolidating' with typical_skip=3
  console.log('New state:', machine.getState(legoId).current_state);
  console.log('New typical skip:', machine.getTypicalSkip(legoId));
}

// ============================================
// Fast-Track Example
// ============================================

function fastTrackExample() {
  const machine = new MasteryStateMachine({
    advancement_threshold: 6,    // Higher threshold
    fast_track_threshold: 5,     // Lower fast-track threshold
  });

  const legoId = 'S0005L02';

  // Record 5 consecutive fast responses
  for (let i = 0; i < 5; i++) {
    const result = machine.recordSmooth(legoId, true); // wasFast=true
    if (result) {
      console.log(`Fast-track! ${result.from_state} → ${result.to_state}`);
    }
  }

  // Should have skipped 'consolidating' and gone straight to 'confident'
  console.log('Final state:', machine.getState(legoId).current_state);
  // Output: "confident"
}

// ============================================
// Discontinuity Example
// ============================================

function discontinuityExample() {
  const machine = new MasteryStateMachine();
  const legoId = 'S0010L05';

  // Advance to 'confident' state
  for (let i = 0; i < 6; i++) {
    machine.recordSmooth(legoId, false);
  }
  console.log('Current state:', machine.getState(legoId).current_state);
  // Output: "confident"

  // Mild discontinuity: no state change, no counter reset
  machine.recordDiscontinuity(legoId, 'mild');
  console.log('After mild:', machine.getState(legoId).current_state);
  // Output: "confident" (unchanged)

  // Moderate discontinuity: no state change, but counters reset
  machine.recordSmooth(legoId, false);
  machine.recordSmooth(legoId, false);
  machine.recordDiscontinuity(legoId, 'moderate');
  console.log('Consecutive smooth reset:', machine.getState(legoId).consecutive_smooth);
  // Output: 0

  // Severe discontinuity: regress one state
  const transition = machine.recordDiscontinuity(legoId, 'severe');
  console.log('After severe:', machine.getState(legoId).current_state);
  // Output: "consolidating" (regressed from confident)

  if (transition) {
    console.log(`Regressed: ${transition.from_state} → ${transition.to_state}`);
  }
}

// ============================================
// Persistence Example
// ============================================

function persistenceExample() {
  const machine = new MasteryStateMachine();

  // Track multiple LEGOs
  machine.recordSmooth('L001', false);
  machine.recordSmooth('L002', true);
  machine.recordSmooth('L003', false);

  // Get all states for persistence
  const states = machine.getAllStates();
  console.log('States to save:', states.length);

  // Simulate saving to database/storage
  const serialized = JSON.stringify(states);

  // Later, load states from storage
  const newMachine = new MasteryStateMachine();
  const loadedStates = JSON.parse(serialized);
  newMachine.loadStates(loadedStates);

  // States are restored
  console.log('L001 state:', newMachine.getState('L001').consecutive_smooth);
  // Output: 1
}

// ============================================
// Integration with Spaced Repetition
// ============================================

function integrationExample() {
  const machine = new MasteryStateMachine();

  // Typical workflow during learning:
  const legoId = 'S0042L03';

  // 1. LEGO is practiced
  // 2. Discontinuity detection happens (in AdaptationEngine)
  const hasDiscontinuity = false; // From discontinuity detector
  const wasFast = true;           // Response was faster than pattern

  // 3. Record result
  if (hasDiscontinuity) {
    // Determine severity based on magnitude
    const severity: 'mild' | 'moderate' | 'severe' = 'moderate';
    machine.recordDiscontinuity(legoId, severity);
  } else {
    machine.recordSmooth(legoId, wasFast);
  }

  // 4. Get typical skip for spaced repetition scheduler
  const skipValue = machine.getTypicalSkip(legoId);
  console.log(`Schedule next practice in ${skipValue} items`);

  // 5. Check current mastery level for UI display
  const state = machine.getState(legoId);
  console.log(`Mastery: ${state.current_state}`);
  console.log(`Progress: ${state.consecutive_smooth}/${machine.getConfig().advancement_threshold}`);
}

// ============================================
// Statistics Example
// ============================================

function statisticsExample() {
  const machine = new MasteryStateMachine();

  // Simulate learning session with multiple LEGOs
  const legos = ['L001', 'L002', 'L003', 'L004', 'L005'];

  for (const lego of legos) {
    // Random number of smooth responses
    const count = Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      machine.recordSmooth(lego, Math.random() > 0.5);
    }

    // Random discontinuities
    if (Math.random() > 0.7) {
      machine.recordDiscontinuity(lego, 'mild');
    }
  }

  // Get statistics
  const stats = machine.getStats();
  console.log('Total LEGOs tracked:', stats.total);
  console.log('By state:', stats.by_state);
  console.log('Average consecutive smooth:', stats.avg_consecutive_smooth.toFixed(2));
  console.log('Average discontinuities:', stats.avg_discontinuity_count.toFixed(2));

  /*
   * Example output:
   * Total LEGOs tracked: 5
   * By state: { acquisition: 3, consolidating: 2, confident: 0, mastered: 0 }
   * Average consecutive smooth: 1.40
   * Average discontinuities: 0.60
   */
}

// Run examples
if (require.main === module) {
  console.log('\n=== Basic Example ===');
  basicExample();

  console.log('\n=== Fast-Track Example ===');
  fastTrackExample();

  console.log('\n=== Discontinuity Example ===');
  discontinuityExample();

  console.log('\n=== Persistence Example ===');
  persistenceExample();

  console.log('\n=== Integration Example ===');
  integrationExample();

  console.log('\n=== Statistics Example ===');
  statisticsExample();
}

export {
  basicExample,
  fastTrackExample,
  discontinuityExample,
  persistenceExample,
  integrationExample,
  statisticsExample,
};
