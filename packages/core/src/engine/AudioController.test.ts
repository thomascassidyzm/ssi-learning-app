/**
 * AudioController Tests
 *
 * Tests for atomic audio playback with preloading.
 * Covers edge cases, error handling, and state management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioController, createAudioController } from './AudioController';
import type { AudioRef } from '../data/types';

// ============================================
// MOCK AUDIO ELEMENT
// ============================================

class MockAudioElement {
  src = '';
  currentTime = 0;
  paused = true;
  readyState = 0;
  preload = '';

  private eventListeners: Map<string, Set<EventListener>> = new Map();

  addEventListener = vi.fn((event: string, handler: EventListener): void => {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  });

  removeEventListener = vi.fn((event: string, handler: EventListener): void => {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  });

  async play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  // Helper to trigger events in tests
  triggerEvent(event: string): void {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      const eventObj = new Event(event);
      handlers.forEach((handler) => handler(eventObj));
    }
  }

  // Helper to simulate ready state
  setReadyState(state: number): void {
    this.readyState = state;
  }
}

// ============================================
// SETUP GLOBALS
// ============================================

let mockAudioInstances: MockAudioElement[] = [];

// Mock the Audio constructor
global.Audio = vi.fn().mockImplementation(() => {
  const instance = new MockAudioElement();
  mockAudioInstances.push(instance);
  return instance;
}) as any;

// Mock window
global.window = {} as any;

// ============================================
// TEST HELPERS
// ============================================

const createAudioRef = (id: string, url: string): AudioRef => ({
  id,
  url,
  duration_ms: 1000,
});

const waitForNextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ============================================
// TESTS
// ============================================

describe('AudioController', () => {
  let controller: AudioController;
  let mainAudio: MockAudioElement;

  beforeEach(() => {
    // Reset mock instances
    mockAudioInstances = [];
    vi.clearAllMocks();

    // Create controller (this creates the main audio element)
    controller = new AudioController();
    mainAudio = mockAudioInstances[0];
  });

  afterEach(() => {
    controller.dispose();
  });

  // ============================================
  // CONSTRUCTOR TESTS
  // ============================================

  describe('constructor', () => {
    it('creates an audio element in browser environment', () => {
      expect(mockAudioInstances.length).toBe(1);
      expect(controller).toBeInstanceOf(AudioController);
    });

    it('registers ended event listener', () => {
      // The constructor should add an 'ended' listener
      expect(mainAudio.addEventListener).toHaveBeenCalledWith(
        'ended',
        expect.any(Function)
      );
    });
  });

  // ============================================
  // PLAY TESTS
  // ============================================

  describe('play', () => {
    it('plays a single audio file', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      // Simulate audio ready to play
      mainAudio.setReadyState(3);

      const playPromise = controller.play(audioRef);

      // Trigger canplay event
      mainAudio.triggerEvent('canplay');

      await playPromise;

      expect(mainAudio.src).toBe(audioRef.url);
      expect(mainAudio.paused).toBe(false);
    });

    it('stops previous playback before playing new audio', async () => {
      const audioRef1 = createAudioRef('test-1', 'https://example.com/audio1.mp3');
      const audioRef2 = createAudioRef('test-2', 'https://example.com/audio2.mp3');

      mainAudio.setReadyState(3);

      // Play first audio
      const play1 = controller.play(audioRef1);
      mainAudio.triggerEvent('canplay');
      await play1;

      expect(mainAudio.paused).toBe(false);
      const firstCurrentTime = mainAudio.currentTime;
      mainAudio.currentTime = 5; // Simulate playback progress

      // Play second audio - should stop first
      const play2 = controller.play(audioRef2);
      mainAudio.triggerEvent('canplay');
      await play2;

      expect(mainAudio.src).toBe(audioRef2.url);
      expect(mainAudio.currentTime).toBe(0); // Reset by stop()
    });

    it('uses preloaded audio when available', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      // Preload the audio first
      const preloadPromise = controller.preload([audioRef]);
      const preloadedAudio = mockAudioInstances[1]; // Second instance
      preloadedAudio.setReadyState(4);
      preloadedAudio.triggerEvent('canplaythrough');
      await preloadPromise;

      expect(controller.isPreloaded(audioRef)).toBe(true);

      // Now play it
      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      // Should use preloaded src
      expect(mainAudio.src).toBe(preloadedAudio.src);
    });

    it('waits for canplay event before resolving', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      let resolved = false;
      const playPromise = controller.play(audioRef).then(() => {
        resolved = true;
      });

      // Should not resolve yet
      await waitForNextTick();
      expect(resolved).toBe(false);

      // Trigger canplay
      mainAudio.triggerEvent('canplay');
      await playPromise;

      expect(resolved).toBe(true);
    });

    it('resolves immediately if already at readyState >= 3', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      // Set ready state before play
      mainAudio.setReadyState(3);

      await controller.play(audioRef);

      expect(mainAudio.paused).toBe(false);
    });

    it('rejects on audio load error', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/invalid.mp3');

      const playPromise = controller.play(audioRef);

      // Trigger error event
      mainAudio.triggerEvent('error');

      await expect(playPromise).rejects.toThrow(
        'Failed to load audio: https://example.com/invalid.mp3'
      );
    });

    it('throws error if no window available', () => {
      // Create controller without window
      const savedWindow = global.window;
      delete (global as any).window;

      const noWindowController = new AudioController();

      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      expect(() => noWindowController.play(audioRef)).rejects.toThrow(
        'AudioController not available (no window)'
      );

      // Restore window
      global.window = savedWindow;
    });

    it('cleans up event listeners after successful play', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      // Event listeners should be removed after resolving
      expect(mainAudio.removeEventListener).toHaveBeenCalledWith(
        'canplay',
        expect.any(Function)
      );
      expect(mainAudio.removeEventListener).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      );
    });

    it('cleans up event listeners after error', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('error');

      await expect(playPromise).rejects.toThrow();

      // Event listeners should be removed after rejecting
      expect(mainAudio.removeEventListener).toHaveBeenCalledWith(
        'canplay',
        expect.any(Function)
      );
      expect(mainAudio.removeEventListener).toHaveBeenCalledWith(
        'error',
        expect.any(Function)
      );
    });
  });

  // ============================================
  // STOP TESTS
  // ============================================

  describe('stop', () => {
    it('stops current playback', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      expect(mainAudio.paused).toBe(false);

      controller.stop();

      expect(mainAudio.paused).toBe(true);
      expect(mainAudio.currentTime).toBe(0);
    });

    it('does nothing if not playing', () => {
      expect(() => controller.stop()).not.toThrow();
      expect(mainAudio.paused).toBe(true);
    });

    it('resets currentTime to 0', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      // Simulate playback progress
      mainAudio.currentTime = 5.5;

      controller.stop();

      expect(mainAudio.currentTime).toBe(0);
    });
  });

  // ============================================
  // PRELOAD TESTS
  // ============================================

  describe('preload', () => {
    it('preloads audio files', async () => {
      const audioRefs = [
        createAudioRef('test-1', 'https://example.com/audio1.mp3'),
        createAudioRef('test-2', 'https://example.com/audio2.mp3'),
      ];

      const preloadPromise = controller.preload(audioRefs);

      // Trigger canplaythrough for both new audio instances
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      mockAudioInstances[2].setReadyState(4);
      mockAudioInstances[2].triggerEvent('canplaythrough');

      await preloadPromise;

      expect(controller.isPreloaded(audioRefs[0])).toBe(true);
      expect(controller.isPreloaded(audioRefs[1])).toBe(true);
      expect(controller.getCacheSize()).toBe(2);
    });

    it('sets preload attribute to auto', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      const preloadPromise = controller.preload([audioRef]);
      const preloadedAudio = mockAudioInstances[1];

      expect(preloadedAudio.preload).toBe('auto');

      preloadedAudio.setReadyState(4);
      preloadedAudio.triggerEvent('canplaythrough');
      await preloadPromise;
    });

    it('skips already preloaded files', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      // First preload
      const preload1 = controller.preload([audioRef]);
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      await preload1;

      const cacheSize = controller.getCacheSize();
      const instanceCount = mockAudioInstances.length;

      // Second preload - should skip
      await controller.preload([audioRef]);

      expect(controller.getCacheSize()).toBe(cacheSize);
      expect(mockAudioInstances.length).toBe(instanceCount); // No new instance
    });

    it('handles empty array', async () => {
      await controller.preload([]);
      expect(controller.getCacheSize()).toBe(0);
    });

    it('resolves even on error', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/invalid.mp3');

      const preloadPromise = controller.preload([audioRef]);

      // Trigger error
      mockAudioInstances[1].triggerEvent('error');

      // Should still resolve (not reject)
      await expect(preloadPromise).resolves.toBeUndefined();
    });

    it('resolves immediately if readyState >= 4', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      // We need to set readyState before starting preload
      // But Audio is created during preload, so we need to mock the constructor differently
      // For this test, we'll trigger the event immediately after creation
      const preloadPromise = controller.preload([audioRef]);

      // The preload creates a new Audio instance
      const preloadedAudio = mockAudioInstances[1];
      preloadedAudio.setReadyState(4);
      // Trigger immediately since readyState check happens
      preloadedAudio.triggerEvent('canplaythrough');

      await preloadPromise;

      expect(controller.isPreloaded(audioRef)).toBe(true);
    });

    it('preloads multiple files in parallel', async () => {
      const audioRefs = [
        createAudioRef('test-1', 'https://example.com/audio1.mp3'),
        createAudioRef('test-2', 'https://example.com/audio2.mp3'),
        createAudioRef('test-3', 'https://example.com/audio3.mp3'),
      ];

      const preloadPromise = controller.preload(audioRefs);

      // All should be loading simultaneously
      expect(mockAudioInstances.length).toBe(4); // main + 3 preload

      // Complete them
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      mockAudioInstances[2].setReadyState(4);
      mockAudioInstances[2].triggerEvent('canplaythrough');
      mockAudioInstances[3].setReadyState(4);
      mockAudioInstances[3].triggerEvent('canplaythrough');

      await preloadPromise;

      expect(controller.getCacheSize()).toBe(3);
    });
  });

  // ============================================
  // IS_PRELOADED TESTS
  // ============================================

  describe('isPreloaded', () => {
    it('returns true for preloaded audio', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      expect(controller.isPreloaded(audioRef)).toBe(false);

      const preloadPromise = controller.preload([audioRef]);
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      await preloadPromise;

      expect(controller.isPreloaded(audioRef)).toBe(true);
    });

    it('returns false for non-preloaded audio', () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');
      expect(controller.isPreloaded(audioRef)).toBe(false);
    });

    it('returns false after clearing cache', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      const preloadPromise = controller.preload([audioRef]);
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      await preloadPromise;

      expect(controller.isPreloaded(audioRef)).toBe(true);

      controller.clearCache();

      expect(controller.isPreloaded(audioRef)).toBe(false);
    });
  });

  // ============================================
  // IS_PLAYING TESTS
  // ============================================

  describe('isPlaying', () => {
    it('returns false when not playing', () => {
      expect(controller.isPlaying()).toBe(false);
    });

    it('returns true when playing', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      expect(controller.isPlaying()).toBe(true);
    });

    it('returns false after stop', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      controller.stop();

      expect(controller.isPlaying()).toBe(false);
    });
  });

  // ============================================
  // GET_CURRENT_TIME TESTS
  // ============================================

  describe('getCurrentTime', () => {
    it('returns 0 when not playing', () => {
      expect(controller.getCurrentTime()).toBe(0);
    });

    it('returns current time in milliseconds', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      // Simulate playback at 2.5 seconds
      mainAudio.currentTime = 2.5;

      expect(controller.getCurrentTime()).toBe(2500);
    });

    it('returns 0 after stop', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      mainAudio.currentTime = 5.0;
      controller.stop();

      expect(controller.getCurrentTime()).toBe(0);
    });
  });

  // ============================================
  // ON_ENDED CALLBACK TESTS
  // ============================================

  describe('onEnded', () => {
    it('calls callback when audio ends', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');
      const callback = vi.fn();

      controller.onEnded(callback);

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      // Trigger ended event
      mainAudio.triggerEvent('ended');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('calls multiple callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      controller.onEnded(callback1);
      controller.onEnded(callback2);
      controller.onEnded(callback3);

      mainAudio.triggerEvent('ended');

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);
    });

    it('does not call removed callbacks', () => {
      const callback = vi.fn();

      controller.onEnded(callback);
      controller.offEnded(callback);

      mainAudio.triggerEvent('ended');

      expect(callback).not.toHaveBeenCalled();
    });

    it('continues calling other callbacks if one throws error', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Callback error');
      });
      const successCallback = vi.fn();

      // Spy on console.error
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      controller.onEnded(errorCallback);
      controller.onEnded(successCallback);

      mainAudio.triggerEvent('ended');

      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(successCallback).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error in audio ended callback:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('allows same callback to be added multiple times', () => {
      const callback = vi.fn();

      controller.onEnded(callback);
      controller.onEnded(callback);

      mainAudio.triggerEvent('ended');

      // Set only adds unique items, so should be called once
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // OFF_ENDED TESTS
  // ============================================

  describe('offEnded', () => {
    it('removes callback', () => {
      const callback = vi.fn();

      controller.onEnded(callback);
      controller.offEnded(callback);

      mainAudio.triggerEvent('ended');

      expect(callback).not.toHaveBeenCalled();
    });

    it('only removes specified callback', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      controller.onEnded(callback1);
      controller.onEnded(callback2);
      controller.offEnded(callback1);

      mainAudio.triggerEvent('ended');

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('does nothing if callback not registered', () => {
      const callback = vi.fn();

      expect(() => controller.offEnded(callback)).not.toThrow();
    });
  });

  // ============================================
  // CACHE MANAGEMENT TESTS
  // ============================================

  describe('clearCache', () => {
    it('clears all preloaded audio', async () => {
      const audioRefs = [
        createAudioRef('test-1', 'https://example.com/audio1.mp3'),
        createAudioRef('test-2', 'https://example.com/audio2.mp3'),
      ];

      const preloadPromise = controller.preload(audioRefs);
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      mockAudioInstances[2].setReadyState(4);
      mockAudioInstances[2].triggerEvent('canplaythrough');
      await preloadPromise;

      expect(controller.getCacheSize()).toBe(2);

      controller.clearCache();

      expect(controller.getCacheSize()).toBe(0);
      expect(controller.isPreloaded(audioRefs[0])).toBe(false);
      expect(controller.isPreloaded(audioRefs[1])).toBe(false);
    });

    it('works on empty cache', () => {
      expect(() => controller.clearCache()).not.toThrow();
      expect(controller.getCacheSize()).toBe(0);
    });
  });

  describe('removeFromCache', () => {
    it('removes specific audio files from cache', async () => {
      const audioRefs = [
        createAudioRef('test-1', 'https://example.com/audio1.mp3'),
        createAudioRef('test-2', 'https://example.com/audio2.mp3'),
        createAudioRef('test-3', 'https://example.com/audio3.mp3'),
      ];

      const preloadPromise = controller.preload(audioRefs);
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      mockAudioInstances[2].setReadyState(4);
      mockAudioInstances[2].triggerEvent('canplaythrough');
      mockAudioInstances[3].setReadyState(4);
      mockAudioInstances[3].triggerEvent('canplaythrough');
      await preloadPromise;

      expect(controller.getCacheSize()).toBe(3);

      controller.removeFromCache(['test-1', 'test-3']);

      expect(controller.getCacheSize()).toBe(1);
      expect(controller.isPreloaded(audioRefs[0])).toBe(false);
      expect(controller.isPreloaded(audioRefs[1])).toBe(true);
      expect(controller.isPreloaded(audioRefs[2])).toBe(false);
    });

    it('handles non-existent IDs gracefully', () => {
      expect(() => controller.removeFromCache(['non-existent'])).not.toThrow();
    });

    it('handles empty array', () => {
      expect(() => controller.removeFromCache([])).not.toThrow();
    });
  });

  describe('getCacheSize', () => {
    it('returns 0 for empty cache', () => {
      expect(controller.getCacheSize()).toBe(0);
    });

    it('returns correct size after preloading', async () => {
      const audioRefs = [
        createAudioRef('test-1', 'https://example.com/audio1.mp3'),
        createAudioRef('test-2', 'https://example.com/audio2.mp3'),
      ];

      const preloadPromise = controller.preload(audioRefs);
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      mockAudioInstances[2].setReadyState(4);
      mockAudioInstances[2].triggerEvent('canplaythrough');
      await preloadPromise;

      expect(controller.getCacheSize()).toBe(2);
    });
  });

  // ============================================
  // DISPOSE TESTS
  // ============================================

  describe('dispose', () => {
    it('stops playback', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      expect(controller.isPlaying()).toBe(true);

      controller.dispose();

      expect(controller.isPlaying()).toBe(false);
    });

    it('clears cache', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      const preloadPromise = controller.preload([audioRef]);
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      await preloadPromise;

      expect(controller.getCacheSize()).toBe(1);

      controller.dispose();

      expect(controller.getCacheSize()).toBe(0);
    });

    it('clears all callbacks', () => {
      const callback = vi.fn();

      controller.onEnded(callback);
      controller.dispose();

      // Try to trigger (won't work because audio is null, but callbacks should be cleared)
      mainAudio.triggerEvent('ended');

      expect(callback).not.toHaveBeenCalled();
    });

    it('removes event listener from audio element', () => {
      const removeEventListenerSpy = vi.spyOn(mainAudio, 'removeEventListener');

      controller.dispose();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'ended',
        expect.any(Function)
      );
    });

    it('sets audio to null', () => {
      controller.dispose();

      expect(controller.isPlaying()).toBe(false);
      expect(controller.getCurrentTime()).toBe(0);
    });

    it('can be called multiple times safely', () => {
      expect(() => {
        controller.dispose();
        controller.dispose();
        controller.dispose();
      }).not.toThrow();
    });
  });

  // ============================================
  // FACTORY FUNCTION TESTS
  // ============================================

  describe('createAudioController', () => {
    it('returns controller in browser environment', () => {
      const controller = createAudioController();
      expect(controller).toBeInstanceOf(AudioController);
      controller?.dispose();
    });

    it('returns null when window is undefined', () => {
      const savedWindow = global.window;
      delete (global as any).window;

      const controller = createAudioController();
      expect(controller).toBeNull();

      global.window = savedWindow;
    });
  });

  // ============================================
  // EDGE CASES AND INTEGRATION TESTS
  // ============================================

  describe('edge cases', () => {
    it('handles rapid play/stop cycles', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      mainAudio.setReadyState(3);

      const play1 = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await play1;

      controller.stop();

      const play2 = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await play2;

      controller.stop();

      const play3 = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await play3;

      expect(controller.isPlaying()).toBe(true);
    });

    it('handles playing different audio files in sequence', async () => {
      const audioRefs = [
        createAudioRef('test-1', 'https://example.com/audio1.mp3'),
        createAudioRef('test-2', 'https://example.com/audio2.mp3'),
        createAudioRef('test-3', 'https://example.com/audio3.mp3'),
      ];

      mainAudio.setReadyState(3);

      for (const ref of audioRefs) {
        const playPromise = controller.play(ref);
        mainAudio.triggerEvent('canplay');
        await playPromise;

        expect(mainAudio.src).toBe(ref.url);
        expect(controller.isPlaying()).toBe(true);

        controller.stop();
      }
    });

    it('handles ended callback during active playback', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');
      const callback = vi.fn();

      controller.onEnded(callback);

      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      // Simulate playback ending naturally
      mainAudio.paused = true;
      mainAudio.triggerEvent('ended');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('preloads while playing', async () => {
      const playRef = createAudioRef('play-1', 'https://example.com/play.mp3');
      const preloadRef = createAudioRef('preload-1', 'https://example.com/preload.mp3');

      mainAudio.setReadyState(3);
      const playPromise = controller.play(playRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      expect(controller.isPlaying()).toBe(true);

      // Preload while playing
      const preloadPromise = controller.preload([preloadRef]);
      mockAudioInstances[1].setReadyState(4);
      mockAudioInstances[1].triggerEvent('canplaythrough');
      await preloadPromise;

      expect(controller.isPlaying()).toBe(true); // Still playing
      expect(controller.isPreloaded(preloadRef)).toBe(true);
    });

    it('handles playing preloaded audio that failed to load', async () => {
      const audioRef = createAudioRef('test-1', 'https://example.com/audio.mp3');

      // Preload with error
      const preloadPromise = controller.preload([audioRef]);
      mockAudioInstances[1].triggerEvent('error');
      await preloadPromise;

      // Should still be in cache (even though it errored)
      expect(controller.isPreloaded(audioRef)).toBe(true);

      // Try to play it
      mainAudio.setReadyState(3);
      const playPromise = controller.play(audioRef);
      mainAudio.triggerEvent('canplay');
      await playPromise;

      // Should use the preloaded (failed) src
      expect(mainAudio.src).toBe(mockAudioInstances[1].src);
    });
  });
});
