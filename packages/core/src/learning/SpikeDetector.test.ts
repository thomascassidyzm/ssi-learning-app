/**
 * Tests for SpikeDetector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpikeDetector, createSpikeDetector } from './SpikeDetector';
import { MetricsTracker, createMetricsTracker } from './MetricsTracker';
import type { SpikeConfig } from '../config/types';

describe('SpikeDetector', () => {
  const defaultSpikeConfig: SpikeConfig = {
    rolling_window_size: 10,
    threshold_percent: 150,
    response_strategy: 'alternate',
    alternate_sequence: ['repeat', 'breakdown'],
    cooldown_items: 3,
  };

  let metricsTracker: MetricsTracker;
  let detector: SpikeDetector;

  beforeEach(() => {
    metricsTracker = createMetricsTracker({ spike: defaultSpikeConfig });
    detector = createSpikeDetector({ spike: defaultSpikeConfig }, metricsTracker);
    metricsTracker.startSession('test-session');
  });

  function recordNResponses(n: number, latency: number = 1000, length: number = 10) {
    for (let i = 0; i < n; i++) {
      metricsTracker.recordResponse(`lego-${i}`, latency, length, 1, 'practice');
    }
  }

  describe('detectSpike', () => {
    it('should not detect spike with insufficient data', () => {
      recordNResponses(3); // Not enough data (need at least 5)

      const result = detector.detectSpike(200); // Way above average

      expect(result.is_spike).toBe(false);
    });

    it('should not detect spike for normal latency', () => {
      recordNResponses(10); // Avg = 100 (1000ms / 10 chars)

      // 100 is exactly average, not a spike
      const result = detector.detectSpike(100);

      expect(result.is_spike).toBe(false);
      expect(result.rolling_average).toBe(100);
    });

    it('should detect spike when latency exceeds threshold', () => {
      recordNResponses(10); // Avg = 100

      // 160 is 1.6x average, above 150% threshold
      const result = detector.detectSpike(160);

      expect(result.is_spike).toBe(true);
      expect(result.ratio).toBeCloseTo(1.6);
      expect(result.threshold).toBe(150); // 100 * 1.5
    });

    it('should not detect spike at exactly threshold', () => {
      recordNResponses(10); // Avg = 100

      // 150 is exactly 1.5x, not above threshold
      const result = detector.detectSpike(150);

      expect(result.is_spike).toBe(false);
    });
  });

  describe('getSpikeResponse', () => {
    it('should return none for non-spike', () => {
      recordNResponses(10);
      const detection = detector.detectSpike(100);

      const response = detector.getSpikeResponse(detection, 'A');

      expect(response.action).toBe('none');
    });

    it('should respect cooldown period', () => {
      recordNResponses(10);

      // Trigger first spike
      detector.processResponse('lego-1', 200, 'A', 1);

      // Second high latency immediately after
      const detection = detector.detectSpike(200);
      const response = detector.getSpikeResponse(detection, 'A');

      expect(response.action).toBe('none');
      expect(response.in_cooldown).toBe(true);
    });

    describe('repeat strategy', () => {
      beforeEach(() => {
        detector.updateConfig({
          spike: { ...defaultSpikeConfig, response_strategy: 'repeat' },
        });
      });

      it('should always return repeat', () => {
        recordNResponses(10);
        const detection = detector.detectSpike(200);

        const response = detector.getSpikeResponse(detection, 'M');

        expect(response.action).toBe('repeat');
      });
    });

    describe('breakdown strategy', () => {
      beforeEach(() => {
        detector.updateConfig({
          spike: { ...defaultSpikeConfig, response_strategy: 'breakdown' },
        });
      });

      it('should return breakdown for M-type', () => {
        recordNResponses(10);
        const detection = detector.detectSpike(200);

        const response = detector.getSpikeResponse(detection, 'M');

        expect(response.action).toBe('breakdown');
      });

      it('should return repeat for A-type (cannot breakdown)', () => {
        recordNResponses(10);
        const detection = detector.detectSpike(200);

        const response = detector.getSpikeResponse(detection, 'A');

        expect(response.action).toBe('repeat');
      });
    });

    describe('alternate strategy', () => {
      it('should alternate between repeat and breakdown', () => {
        recordNResponses(10); // Avg = 100

        // First spike - should be repeat (first in sequence)
        // 200 is 2x average, above 150% threshold
        const result1 = detector.processResponse('lego-1', 200, 'M', 1);
        expect(result1.response.action).toBe('repeat');

        // Pass cooldown AND reset the window by calling processResponse
        // (processResponse increments items_since_spike AND records to metrics)
        for (let i = 0; i < 10; i++) {
          metricsTracker.recordResponse(`cooldown-1-${i}`, 1000, 10, 1, 'practice');
          detector.processResponse(`cooldown-1-${i}`, 100, 'A', 1); // 100 is normal latency
        }

        // Second spike - should be breakdown (second in sequence)
        // Window is back to ~100 avg, 200 triggers
        const result2 = detector.processResponse('lego-2', 200, 'M', 1);
        expect(result2.response.action).toBe('breakdown');

        // Pass cooldown and reset window
        for (let i = 0; i < 10; i++) {
          metricsTracker.recordResponse(`cooldown-2-${i}`, 1000, 10, 1, 'practice');
          detector.processResponse(`cooldown-2-${i}`, 100, 'A', 1);
        }

        // Third spike - should wrap back to repeat
        const result3 = detector.processResponse('lego-3', 200, 'M', 1);
        expect(result3.response.action).toBe('repeat');
      });

      it('should fall back to repeat when breakdown requested for A-type', () => {
        recordNResponses(10); // Avg = 100

        // First spike - repeat
        detector.processResponse('lego-1', 200, 'A', 1);

        // Pass cooldown AND reset window
        for (let i = 0; i < 10; i++) {
          metricsTracker.recordResponse(`cooldown-${i}`, 1000, 10, 1, 'practice');
          detector.processResponse(`cooldown-${i}`, 100, 'A', 1);
        }

        // Second spike - would be breakdown, but A-type falls back to repeat
        const result = detector.processResponse('lego-2', 200, 'A', 1);
        expect(result.response.action).toBe('repeat');
      });
    });
  });

  describe('processResponse', () => {
    it('should increment items since spike', () => {
      recordNResponses(10);

      detector.processResponse('lego-1', 100, 'A', 1); // Normal
      detector.processResponse('lego-2', 100, 'A', 1); // Normal

      const state = detector.getAdaptationState();
      // Started at Infinity, then reset on each non-spike would be wrong
      // Actually it just increments
      expect(state.items_since_spike).toBeGreaterThan(0);
    });

    it('should reset items since spike after spike', () => {
      recordNResponses(10);

      // Trigger spike
      detector.processResponse('lego-1', 200, 'A', 1);

      const state = detector.getAdaptationState();
      expect(state.items_since_spike).toBe(0);
    });

    it('should create spike event when spike triggered', () => {
      recordNResponses(10);

      const result = detector.processResponse('lego-spike', 200, 'A', 1);

      expect(result.spike).toBeDefined();
      expect(result.spike?.lego_id).toBe('lego-spike');
      expect(result.spike?.response).toBe('repeat');
    });

    it('should not create spike event in cooldown', () => {
      recordNResponses(10);

      // First spike
      detector.processResponse('lego-1', 200, 'A', 1);

      // Second high latency during cooldown
      const result = detector.processResponse('lego-2', 200, 'A', 1);

      expect(result.spike).toBeUndefined();
      expect(result.response.in_cooldown).toBe(true);
    });
  });

  describe('state management', () => {
    it('should reset state', () => {
      recordNResponses(10);
      detector.processResponse('lego-1', 200, 'A', 1); // Trigger spike

      detector.resetState();

      const state = detector.getAdaptationState();
      expect(state.items_since_spike).toBe(Infinity);
      expect(state.alternate_index).toBe(0);
    });

    it('should update config', () => {
      detector.updateConfig({
        spike: { ...defaultSpikeConfig, threshold_percent: 200 },
      });

      recordNResponses(10); // Avg = 100

      // 160 would be spike at 150%, but not at 200%
      const result = detector.detectSpike(160);
      expect(result.is_spike).toBe(false);
    });
  });

  describe('factory function', () => {
    it('should create detector via factory', () => {
      const tracker = createMetricsTracker({ spike: defaultSpikeConfig });
      const det = createSpikeDetector({ spike: defaultSpikeConfig }, tracker);

      expect(det).toBeInstanceOf(SpikeDetector);
    });
  });
});
