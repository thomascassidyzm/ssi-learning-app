/**
 * WeightedSelector Usage Example
 *
 * This example demonstrates how to use the WeightedSelector class
 * for probabilistic LEGO selection in the SSi Learning App.
 */

import {
  createWeightedSelector,
  type LegoCandidate,
  type WeightedSelectionConfig,
} from './WeightedSelector';

// ============================================
// EXAMPLE 1: Basic Usage
// ============================================

function example1_basicUsage() {
  // Create selector with default configuration
  const selector = createWeightedSelector();

  // Create some candidate LEGOs
  const candidates: LegoCandidate[] = [
    {
      lego_id: 'lego_1',
      data: {
        last_practice_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        discontinuity_count: 2,
      },
    },
    {
      lego_id: 'lego_2',
      data: {
        last_practice_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        discontinuity_count: 0,
      },
    },
    {
      lego_id: 'lego_3',
      data: {
        last_practice_at: null, // Never practiced
        discontinuity_count: 0,
      },
    },
  ];

  // Select a LEGO (probabilistically favors stale and struggling items)
  const selected = selector.selectFromCandidates(candidates);

  console.log('Selected LEGO:', selected.lego_id);
  console.log('Weight:', selected.weight);
  console.log('Probability:', selected.probability);
}

// ============================================
// EXAMPLE 2: Custom Configuration
// ============================================

function example2_customConfig() {
  // Create selector with custom staleness and struggle parameters
  const config: WeightedSelectionConfig = {
    staleness_rate: 0.2, // Higher staleness boost (default: 0.1)
    struggle_multiplier: 1.0, // Higher struggle boost (default: 0.5)
    recency_window: 60, // Longer recency window (default: 30 min)
  };

  const selector = createWeightedSelector(config);

  // Use selector...
}

// ============================================
// EXAMPLE 3: Integration with AdaptationEngine
// ============================================

function example3_integrationWithAdaptation() {
  const selector = createWeightedSelector();

  // After practicing a LEGO
  const legoId = 'lego_1';
  selector.updateAfterPractice(legoId);

  // When AdaptationEngine detects a discontinuity (spike, hesitation, etc.)
  selector.recordDiscontinuity(legoId);

  // Get current state
  const data = selector.getLegoData(legoId);
  console.log('LEGO data:', data);
}

// ============================================
// EXAMPLE 4: Weight Calculation Inspection
// ============================================

function example4_inspectWeights() {
  const selector = createWeightedSelector();

  const legoData = {
    last_practice_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    discontinuity_count: 4,
  };

  const calculation = selector.calculateWeight('lego_1', legoData);

  console.log('Weight breakdown:', {
    total_weight: calculation.weight,
    base_weight: calculation.factors.base_weight,
    staleness_factor: calculation.factors.staleness_factor,
    struggle_factor: calculation.factors.struggle_factor,
    recency_factor: calculation.factors.recency_factor,
  });

  console.log('Diagnostics:', calculation.diagnostics);
}

// ============================================
// EXAMPLE 5: Periodic Maintenance
// ============================================

function example5_periodicMaintenance() {
  const selector = createWeightedSelector();

  // At the start of each session, decay old discontinuity counts
  // This prevents permanent penalties for LEGOs that struggled in the past
  // but haven't been practiced recently

  // Decay discontinuities for LEGOs not practiced in 7+ days
  selector.decayDiscontinuityCounts(
    7, // daysSinceLastPractice threshold
    1  // decayAmount (reduce count by 1)
  );

  console.log('Discontinuity counts decayed for stale items');
}

// ============================================
// EXAMPLE 6: Persistence Integration
// ============================================

function example6_persistence() {
  const selector = createWeightedSelector();

  // Save all LEGO data to persistence layer (e.g., localStorage, IndexedDB)
  const allData = selector.getAllLegoData();
  const serialized = JSON.stringify(
    Array.from(allData.entries()).map(([id, data]) => ({
      lego_id: id,
      last_practice_at: data.last_practice_at?.toISOString() || null,
      discontinuity_count: data.discontinuity_count,
    }))
  );

  console.log('Saved data:', serialized);

  // Later: Restore data from persistence
  const restored = JSON.parse(serialized);
  const newSelector = createWeightedSelector();

  restored.forEach((entry: any) => {
    newSelector.setLegoData(entry.lego_id, {
      last_practice_at: entry.last_practice_at
        ? new Date(entry.last_practice_at)
        : null,
      discontinuity_count: entry.discontinuity_count,
    });
  });

  console.log('Data restored');
}

// ============================================
// EXAMPLE 7: Statistical Distribution Visualization
// ============================================

function example7_statisticalDistribution() {
  const selector = createWeightedSelector();

  // Create a diverse pool of candidates
  const candidates: LegoCandidate[] = [
    {
      lego_id: 'never_practiced',
      data: { last_practice_at: null, discontinuity_count: 0 },
    },
    {
      lego_id: 'very_stale',
      data: {
        last_practice_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        discontinuity_count: 0,
      },
    },
    {
      lego_id: 'struggling',
      data: {
        last_practice_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        discontinuity_count: 5,
      },
    },
    {
      lego_id: 'recent_smooth',
      data: {
        last_practice_at: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        discontinuity_count: 0,
      },
    },
  ];

  // Run many selections and count distribution
  const selections = new Map<string, number>();
  const trials = 10000;

  for (let i = 0; i < trials; i++) {
    const selected = selector.selectFromCandidates([...candidates]);
    selections.set(
      selected.lego_id,
      (selections.get(selected.lego_id) || 0) + 1
    );
  }

  // Display distribution
  console.log('Selection distribution over', trials, 'trials:');
  selections.forEach((count, legoId) => {
    const percentage = ((count / trials) * 100).toFixed(1);
    console.log(`  ${legoId}: ${count} (${percentage}%)`);
  });
}

// Run examples (commented out - uncomment to execute)
// example1_basicUsage();
// example2_customConfig();
// example3_integrationWithAdaptation();
// example4_inspectWeights();
// example5_periodicMaintenance();
// example6_persistence();
// example7_statisticalDistribution();
