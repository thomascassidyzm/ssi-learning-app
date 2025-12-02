/**
 * Tests for MetricsTracker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsTracker, createMetricsTracker } from './MetricsTracker';
import type { SpikeConfig } from '../config/types';

describe('MetricsTracker', () => {
  const defaultSpikeConfig: SpikeConfig = {
    rolling_window_size: 10,
    threshold_percent: 150,
    response_strategy: 'alternate',
    alternate_sequence: ['repeat', 'breakdown'],
    cooldown_items: 3,
  };

  let tracker: MetricsTracker;

  beforeEach(() => {
    tracker = createMetricsTracker({ spike: defaultSpikeConfig });
  });

  describe('session management', () => {
    it('should start a session', () => {
      tracker.startSession('session-1');
      const session = tracker.getCurrentSession();

      expect(session).not.toBeNull();
      expect(session?.session_id).toBe('session-1');
      expect(session?.items_practiced).toBe(0);
      expect(session?.ended_at).toBeNull();
    });

    it('should end a session', () => {
      tracker.startSession('session-1');
      tracker.recordResponse('lego-1', 1000, 10, 1, 'practice');

      const session = tracker.endSession();

      expect(session).not.toBeNull();
      expect(session?.ended_at).not.toBeNull();
      expect(session?.items_practiced).toBe(1);
      expect(tracker.getCurrentSession()).toBeNull();
    });

    it('should auto-end previous session when starting new one', () => {
      tracker.startSession('session-1');
      tracker.recordResponse('lego-1', 1000, 10, 1, 'practice');

      tracker.startSession('session-2');

      const session = tracker.getCurrentSession();
      expect(session?.session_id).toBe('session-2');
      expect(session?.items_practiced).toBe(0);
    });
  });

  describe('response recording', () => {
    beforeEach(() => {
      tracker.startSession('test-session');
    });

    it('should record a response metric', () => {
      const metric = tracker.recordResponse('lego-1', 1000, 20, 1, 'practice');

      expect(metric.lego_id).toBe('lego-1');
      expect(metric.response_latency_ms).toBe(1000);
      expect(metric.phrase_length).toBe(20);
      expect(metric.thread_id).toBe(1);
      expect(metric.mode).toBe('practice');
      expect(metric.triggered_spike).toBe(false);
    });

    it('should normalize latency by phrase length', () => {
      const metric = tracker.recordResponse('lego-1', 1000, 20, 1, 'practice');

      // 1000ms / 20 chars = 50 ms/char
      expect(metric.normalized_latency).toBe(50);
    });

    it('should use minimum phrase length for short phrases', () => {
      const metric = tracker.recordResponse('lego-1', 100, 2, 1, 'practice');

      // Should use min length of 5: 100ms / 5 = 20
      expect(metric.normalized_latency).toBe(20);
    });

    it('should update session metrics', () => {
      tracker.recordResponse('lego-1', 1000, 10, 1, 'practice');
      tracker.recordResponse('lego-2', 1500, 15, 2, 'review');

      const session = tracker.getCurrentSession();
      expect(session?.items_practiced).toBe(2);
      expect(session?.metrics.length).toBe(2);
    });
  });

  describe('rolling window', () => {
    beforeEach(() => {
      tracker.startSession('test-session');
    });

    it('should maintain rolling window', () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordResponse(`lego-${i}`, 1000, 10, 1, 'practice');
      }

      expect(tracker.getRollingWindow().length).toBe(5);
    });

    it('should cap rolling window at configured size', () => {
      // Record more than window size
      for (let i = 0; i < 15; i++) {
        tracker.recordResponse(`lego-${i}`, 1000, 10, 1, 'practice');
      }

      expect(tracker.getRollingWindow().length).toBe(10); // defaultSpikeConfig.rolling_window_size
    });

    it('should calculate rolling average', () => {
      // All same: 1000ms, 10 chars = 100 normalized
      for (let i = 0; i < 5; i++) {
        tracker.recordResponse(`lego-${i}`, 1000, 10, 1, 'practice');
      }

      expect(tracker.getRollingAverage()).toBe(100);
    });

    it('should return 0 for empty window', () => {
      expect(tracker.getRollingAverage()).toBe(0);
    });
  });

  describe('hasEnoughData', () => {
    beforeEach(() => {
      tracker.startSession('test-session');
    });

    it('should return false with no data', () => {
      expect(tracker.hasEnoughData()).toBe(false);
    });

    it('should return false with less than half window', () => {
      for (let i = 0; i < 4; i++) {
        tracker.recordResponse(`lego-${i}`, 1000, 10, 1, 'practice');
      }

      expect(tracker.hasEnoughData()).toBe(false);
    });

    it('should return true with half window', () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordResponse(`lego-${i}`, 1000, 10, 1, 'practice');
      }

      expect(tracker.hasEnoughData()).toBe(true);
    });
  });

  describe('event listeners', () => {
    it('should emit session_started event', () => {
      const listener = vi.fn();
      tracker.addListener(listener);

      tracker.startSession('session-1');

      expect(listener).toHaveBeenCalledWith({
        type: 'session_started',
        session_id: 'session-1',
      });
    });

    it('should emit item_completed event', () => {
      const listener = vi.fn();
      tracker.addListener(listener);
      tracker.startSession('session-1');

      tracker.recordResponse('lego-1', 1000, 10, 1, 'practice');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'item_completed',
          metric: expect.objectContaining({
            lego_id: 'lego-1',
          }),
        })
      );
    });

    it('should emit session_ended event', () => {
      const listener = vi.fn();
      tracker.addListener(listener);
      tracker.startSession('session-1');

      tracker.endSession();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session_ended',
          session: expect.objectContaining({
            session_id: 'session-1',
          }),
        })
      );
    });

    it('should remove listeners', () => {
      const listener = vi.fn();
      tracker.addListener(listener);
      tracker.removeListener(listener);

      tracker.startSession('session-1');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('spike recording', () => {
    beforeEach(() => {
      tracker.startSession('test-session');
    });

    it('should record spike events', () => {
      tracker.recordResponse('lego-1', 1000, 10, 1, 'practice');

      const spike = {
        id: 'spike-1',
        lego_id: 'lego-1',
        timestamp: new Date(),
        latency: 200,
        rolling_average: 100,
        spike_ratio: 2.0,
        response: 'repeat' as const,
        thread_id: 1,
      };

      tracker.recordSpike(spike);

      const session = tracker.getCurrentSession();
      expect(session?.spikes_detected).toBe(1);
      expect(session?.spikes[0].id).toBe('spike-1');
    });

    it('should mark metric as triggering spike', () => {
      tracker.recordResponse('lego-1', 1000, 10, 1, 'practice');

      tracker.recordSpike({
        id: 'spike-1',
        lego_id: 'lego-1',
        timestamp: new Date(),
        latency: 200,
        rolling_average: 100,
        spike_ratio: 2.0,
        response: 'repeat',
        thread_id: 1,
      });

      const window = tracker.getRollingWindow();
      expect(window[0].triggered_spike).toBe(true);
    });
  });

  describe('config updates', () => {
    it('should update spike config', () => {
      tracker.startSession('session-1');

      // Fill window
      for (let i = 0; i < 10; i++) {
        tracker.recordResponse(`lego-${i}`, 1000, 10, 1, 'practice');
      }

      // Update to smaller window
      tracker.updateConfig({
        spike: { ...defaultSpikeConfig, rolling_window_size: 5 },
      });

      // New items should respect new window size
      for (let i = 0; i < 10; i++) {
        tracker.recordResponse(`lego-new-${i}`, 1000, 10, 1, 'practice');
      }

      expect(tracker.getRollingWindow().length).toBe(5);
    });
  });
});
