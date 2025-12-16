import { describe, it, expect, beforeEach } from 'vitest';
import {
  WeightedSelector,
  createWeightedSelector,
  type LegoCandidate,
  type LegoSelectionData,
} from './WeightedSelector';

describe('WeightedSelector', () => {
  let selector: WeightedSelector;

  beforeEach(() => {
    selector = createWeightedSelector();
  });

  describe('calculateWeight', () => {
    it('should calculate base weight of 1.0 for recently practiced item with no discontinuities', () => {
      const data: LegoSelectionData = {
        last_practice_at: new Date(), // Just now
        discontinuity_count: 0,
      };

      const result = selector.calculateWeight('test_lego', data);

      // Base weight (1.0) * staleness (≈1.0) * struggle (1.0) * recency (≈0.5 for just now)
      expect(result.weight).toBeGreaterThan(0);
      expect(result.weight).toBeLessThan(1.5);
      expect(result.factors.base_weight).toBe(1.0);
      expect(result.factors.struggle_factor).toBe(1.0);
    });

    it('should increase weight for stale items (not practiced in days)', () => {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const data: LegoSelectionData = {
        last_practice_at: oneDayAgo,
        discontinuity_count: 0,
      };

      const result = selector.calculateWeight('stale_lego', data);

      // With staleness_rate = 0.1, one day = 1 + (1 * 0.1) = 1.1x staleness
      expect(result.factors.staleness_factor).toBeGreaterThan(1.0);
      expect(result.diagnostics.days_since_practice).toBeGreaterThanOrEqual(1);
    });

    it('should increase weight for items with discontinuities', () => {
      const data: LegoSelectionData = {
        last_practice_at: new Date(),
        discontinuity_count: 3,
      };

      const result = selector.calculateWeight('struggle_lego', data);

      // With struggle_multiplier = 0.5, 3 discontinuities = 1 + (3 * 0.5) = 2.5x
      expect(result.factors.struggle_factor).toBe(2.5);
    });

    it('should massively boost weight for never-practiced items', () => {
      const data: LegoSelectionData = {
        last_practice_at: null,
        discontinuity_count: 0,
      };

      const result = selector.calculateWeight('new_lego', data);

      // Never practiced = huge staleness boost (capped at 1 year equivalent)
      expect(result.factors.staleness_factor).toBeGreaterThan(30);
    });

    it('should apply recency penalty for very recent practice', () => {
      const twoMinutesAgo = new Date();
      twoMinutesAgo.setMinutes(twoMinutesAgo.getMinutes() - 2);

      const data: LegoSelectionData = {
        last_practice_at: twoMinutesAgo,
        discontinuity_count: 0,
      };

      const result = selector.calculateWeight('recent_lego', data);

      // recency_window = 30 min, 2 min ago = 1 - (2/30) ≈ 0.93
      expect(result.factors.recency_factor).toBeLessThan(1.0);
      expect(result.factors.recency_factor).toBeGreaterThan(0.5);
    });

    it('should have minimum recency penalty of 0.5 for just-practiced items', () => {
      // Just practiced (0 minutes ago) should hit the 0.5 floor
      const justNow = new Date();

      const data: LegoSelectionData = {
        last_practice_at: justNow,
        discontinuity_count: 0,
      };

      const result = selector.calculateWeight('just_practiced', data);

      // recency_factor = 0.5 + 0.5 * (0/30) = 0.5
      expect(result.factors.recency_factor).toBe(0.5);
    });

    it('should combine all factors multiplicatively', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const data: LegoSelectionData = {
        last_practice_at: threeDaysAgo,
        discontinuity_count: 2,
      };

      const result = selector.calculateWeight('complex_lego', data);

      // Should be: 1.0 * (1 + 3*0.1) * (1 + 2*0.5) * recency
      // 3 days = 4320 minutes, way beyond recency_window (30), so recency = 1.0
      // = 1.0 * 1.3 * 2.0 * 1.0 = 2.6
      expect(result.weight).toBeCloseTo(2.6, 1);
      expect(result.factors.staleness_factor).toBeCloseTo(1.3, 1);
      expect(result.factors.struggle_factor).toBe(2.0);
      expect(result.factors.recency_factor).toBe(1.0);
    });
  });

  describe('selectFromCandidates', () => {
    it('should throw error for empty candidates array', () => {
      expect(() => selector.selectFromCandidates([])).toThrow(
        'Cannot select from empty candidates array'
      );
    });

    it('should return single candidate with probability 1.0', () => {
      const candidates: LegoCandidate[] = [
        {
          lego_id: 'only_one',
          data: {
            last_practice_at: new Date(),
            discontinuity_count: 0,
          },
        },
      ];

      const selected = selector.selectFromCandidates(candidates);

      expect(selected.lego_id).toBe('only_one');
      expect(selected.probability).toBe(1.0);
    });

    it('should select from multiple candidates using weighted probabilities', () => {
      const candidates: LegoCandidate[] = [
        {
          lego_id: 'stale_lego',
          data: {
            last_practice_at: (() => {
              const d = new Date();
              d.setDate(d.getDate() - 7);
              return d;
            })(),
            discontinuity_count: 0,
          },
        },
        {
          lego_id: 'recent_lego',
          data: {
            last_practice_at: new Date(),
            discontinuity_count: 0,
          },
        },
      ];

      const selected = selector.selectFromCandidates(candidates);

      // Should be one of the candidates
      expect(['stale_lego', 'recent_lego']).toContain(selected.lego_id);

      // Should have calculated weights and probabilities
      expect(selected.weight).toBeDefined();
      expect(selected.probability).toBeDefined();
      expect(selected.probability).toBeGreaterThan(0);
      expect(selected.probability).toBeLessThanOrEqual(1);
    });

    it('should favor stale items over recent items statistically', () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const fiveMinutesAgo = new Date();
      fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

      const candidates: LegoCandidate[] = [
        {
          lego_id: 'very_stale',
          data: {
            last_practice_at: tenDaysAgo,
            discontinuity_count: 0,
          },
        },
        {
          lego_id: 'recent',
          data: {
            last_practice_at: fiveMinutesAgo,
            discontinuity_count: 0,
          },
        },
      ];

      // Run selection multiple times and count
      const selections = new Map<string, number>();
      const trials = 1000;

      for (let i = 0; i < trials; i++) {
        const selected = selector.selectFromCandidates([...candidates]);
        selections.set(
          selected.lego_id,
          (selections.get(selected.lego_id) || 0) + 1
        );
      }

      const staleCount = selections.get('very_stale') || 0;
      const recentCount = selections.get('recent') || 0;

      // Very stale should be selected significantly more often
      // stale has staleness ~2.0, recent has staleness ~1.0, both have recency ~0.5-0.8
      // So stale should win about 2:1
      expect(staleCount).toBeGreaterThan(recentCount);
    });

    it('should favor struggling items statistically', () => {
      const candidates: LegoCandidate[] = [
        {
          lego_id: 'struggling',
          data: {
            last_practice_at: new Date(),
            discontinuity_count: 5,
          },
        },
        {
          lego_id: 'smooth',
          data: {
            last_practice_at: new Date(),
            discontinuity_count: 0,
          },
        },
      ];

      const selections = new Map<string, number>();
      const trials = 1000;

      for (let i = 0; i < trials; i++) {
        const selected = selector.selectFromCandidates([...candidates]);
        selections.set(
          selected.lego_id,
          (selections.get(selected.lego_id) || 0) + 1
        );
      }

      const strugglingCount = selections.get('struggling') || 0;
      const smoothCount = selections.get('smooth') || 0;

      // Struggling item should be selected more often
      expect(strugglingCount).toBeGreaterThan(smoothCount);
    });

    it('should normalize probabilities to sum to 1.0', () => {
      const candidates: LegoCandidate[] = [
        {
          lego_id: 'a',
          data: { last_practice_at: new Date(), discontinuity_count: 0 },
        },
        {
          lego_id: 'b',
          data: { last_practice_at: new Date(), discontinuity_count: 1 },
        },
        {
          lego_id: 'c',
          data: { last_practice_at: new Date(), discontinuity_count: 2 },
        },
      ];

      selector.selectFromCandidates(candidates);

      // After selection, all candidates should have probabilities
      const totalProbability = candidates.reduce(
        (sum, c) => sum + (c.probability || 0),
        0
      );

      expect(totalProbability).toBeCloseTo(1.0, 5);
    });
  });

  describe('updateAfterPractice', () => {
    it('should update last_practice_at timestamp', () => {
      const before = new Date();
      selector.updateAfterPractice('test_lego');
      const after = new Date();

      const data = selector.getLegoData('test_lego');

      expect(data.last_practice_at).not.toBeNull();
      expect(data.last_practice_at!.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(data.last_practice_at!.getTime()).toBeLessThanOrEqual(
        after.getTime()
      );
    });

    it('should preserve discontinuity count', () => {
      selector.recordDiscontinuity('test_lego');
      selector.recordDiscontinuity('test_lego');

      selector.updateAfterPractice('test_lego');

      const data = selector.getLegoData('test_lego');
      expect(data.discontinuity_count).toBe(2);
    });
  });

  describe('recordDiscontinuity', () => {
    it('should increment discontinuity count', () => {
      selector.recordDiscontinuity('test_lego');
      let data = selector.getLegoData('test_lego');
      expect(data.discontinuity_count).toBe(1);

      selector.recordDiscontinuity('test_lego');
      data = selector.getLegoData('test_lego');
      expect(data.discontinuity_count).toBe(2);
    });

    it('should preserve last_practice_at', () => {
      const timestamp = new Date();
      selector.setLegoData('test_lego', {
        last_practice_at: timestamp,
        discontinuity_count: 0,
      });

      selector.recordDiscontinuity('test_lego');

      const data = selector.getLegoData('test_lego');
      expect(data.last_practice_at).toEqual(timestamp);
    });
  });

  describe('getLegoData / setLegoData', () => {
    it('should return defaults for unknown LEGO', () => {
      const data = selector.getLegoData('unknown');

      expect(data.last_practice_at).toBeNull();
      expect(data.discontinuity_count).toBe(0);
    });

    it('should store and retrieve LEGO data', () => {
      const timestamp = new Date();
      const inputData: LegoSelectionData = {
        last_practice_at: timestamp,
        discontinuity_count: 5,
      };

      selector.setLegoData('stored_lego', inputData);

      const retrieved = selector.getLegoData('stored_lego');

      expect(retrieved.last_practice_at).toEqual(timestamp);
      expect(retrieved.discontinuity_count).toBe(5);
    });
  });

  describe('getAllLegoData', () => {
    it('should return all tracked LEGO data', () => {
      selector.updateAfterPractice('lego1');
      selector.recordDiscontinuity('lego2');
      selector.updateAfterPractice('lego3');

      const allData = selector.getAllLegoData();

      expect(allData.size).toBe(3);
      expect(allData.has('lego1')).toBe(true);
      expect(allData.has('lego2')).toBe(true);
      expect(allData.has('lego3')).toBe(true);
    });
  });

  describe('clearAllData', () => {
    it('should clear all tracked data', () => {
      selector.updateAfterPractice('lego1');
      selector.recordDiscontinuity('lego2');

      selector.clearAllData();

      const allData = selector.getAllLegoData();
      expect(allData.size).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration parameters', () => {
      selector.updateConfig({
        staleness_rate: 0.2,
        struggle_multiplier: 1.0,
      });

      const config = selector.getConfig();

      expect(config.staleness_rate).toBe(0.2);
      expect(config.struggle_multiplier).toBe(1.0);
      expect(config.recency_window).toBe(30); // Unchanged
    });

    it('should affect weight calculations', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const data: LegoSelectionData = {
        last_practice_at: threeDaysAgo,
        discontinuity_count: 0,
      };

      const result1 = selector.calculateWeight('test', data);

      selector.updateConfig({ staleness_rate: 0.3 });

      const result2 = selector.calculateWeight('test', data);

      // Higher staleness_rate should produce higher weight
      expect(result2.weight).toBeGreaterThan(result1.weight);
    });
  });

  describe('decayDiscontinuityCounts', () => {
    it('should decay discontinuity counts for old items', () => {
      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

      selector.setLegoData('old_lego', {
        last_practice_at: eightDaysAgo,
        discontinuity_count: 5,
      });

      selector.decayDiscontinuityCounts(7, 1); // 7 day threshold, decay by 1

      const data = selector.getLegoData('old_lego');
      expect(data.discontinuity_count).toBe(4);
    });

    it('should not decay recent items', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      selector.setLegoData('recent_lego', {
        last_practice_at: twoDaysAgo,
        discontinuity_count: 5,
      });

      selector.decayDiscontinuityCounts(7, 1);

      const data = selector.getLegoData('recent_lego');
      expect(data.discontinuity_count).toBe(5); // Unchanged
    });

    it('should not go below zero', () => {
      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

      selector.setLegoData('low_count', {
        last_practice_at: eightDaysAgo,
        discontinuity_count: 1,
      });

      selector.decayDiscontinuityCounts(7, 5); // Try to decay by more than count

      const data = selector.getLegoData('low_count');
      expect(data.discontinuity_count).toBe(0);
    });

    it('should skip items never practiced', () => {
      selector.setLegoData('never_practiced', {
        last_practice_at: null,
        discontinuity_count: 5,
      });

      selector.decayDiscontinuityCounts(7, 1);

      const data = selector.getLegoData('never_practiced');
      expect(data.discontinuity_count).toBe(5); // Unchanged
    });
  });

  describe('createWeightedSelector factory', () => {
    it('should create selector with default config', () => {
      const s = createWeightedSelector();
      const config = s.getConfig();

      expect(config.staleness_rate).toBe(0.1);
      expect(config.struggle_multiplier).toBe(0.5);
      expect(config.recency_window).toBe(30);
    });

    it('should create selector with custom config', () => {
      const s = createWeightedSelector({
        staleness_rate: 0.2,
        recency_window: 60,
      });

      const config = s.getConfig();

      expect(config.staleness_rate).toBe(0.2);
      expect(config.struggle_multiplier).toBe(0.5); // Default
      expect(config.recency_window).toBe(60);
    });
  });

  describe('integration: realistic selection scenario', () => {
    it('should select appropriately from mixed pool', () => {
      const now = new Date();

      const candidates: LegoCandidate[] = [
        // Never practiced - should have highest weight
        {
          lego_id: 'new_lego',
          data: {
            last_practice_at: null,
            discontinuity_count: 0,
          },
        },
        // Practiced yesterday, struggling
        {
          lego_id: 'struggling_lego',
          data: {
            last_practice_at: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            discontinuity_count: 4,
          },
        },
        // Practiced 5 days ago, smooth
        {
          lego_id: 'stale_lego',
          data: {
            last_practice_at: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
            discontinuity_count: 0,
          },
        },
        // Practiced just now, smooth - should have lowest weight
        {
          lego_id: 'just_practiced',
          data: {
            last_practice_at: now,
            discontinuity_count: 0,
          },
        },
      ];

      const selections = new Map<string, number>();
      const trials = 1000;

      for (let i = 0; i < trials; i++) {
        const selected = selector.selectFromCandidates([...candidates]);
        selections.set(
          selected.lego_id,
          (selections.get(selected.lego_id) || 0) + 1
        );
      }

      const newCount = selections.get('new_lego') || 0;
      const strugglingCount = selections.get('struggling_lego') || 0;
      const staleCount = selections.get('stale_lego') || 0;
      const justPracticedCount = selections.get('just_practiced') || 0;

      // New should be selected most
      expect(newCount).toBeGreaterThan(strugglingCount);
      expect(newCount).toBeGreaterThan(staleCount);

      // Just practiced should be selected least
      expect(justPracticedCount).toBeLessThan(newCount);
      expect(justPracticedCount).toBeLessThan(strugglingCount);
    });
  });
});
