/**
 * Comprehensive tests for CycleOrchestrator
 * Tests phase transitions, text visibility, event emission, and adaptive pause duration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CycleOrchestrator } from './CycleOrchestrator';
import type { IAudioController, CyclePhase, CycleEvent, CycleEventListener } from './types';
import { CyclePhase as Phase } from './types';
import type { LearningItem, LegoPair, PracticePhrase, SeedPair } from '../data/types';
import type { CycleConfig } from '../config/types';

// ============================================
// MOCK DATA
// ============================================

const mockLego: LegoPair = {
  id: 'S0001L01',
  type: 'A',
  new: true,
  lego: { known: 'hello', target: '你好' },
  audioRefs: {
    known: { id: 'k1', url: '/audio/k1.mp3' },
    target: {
      voice1: { id: 't1v1', url: '/audio/t1v1.mp3' },
      voice2: { id: 't1v2', url: '/audio/t1v2.mp3' },
    },
  },
};

const mockPhrase: PracticePhrase = {
  id: 'P001',
  phraseType: 'debut',
  phrase: { known: 'hello', target: '你好' },
  audioRefs: {
    known: { id: 'k1', url: '/audio/k1.mp3' },
    target: {
      voice1: { id: 't1v1', url: '/audio/t1v1.mp3' },
      voice2: { id: 't1v2', url: '/audio/t1v2.mp3' },
    },
  },
  wordCount: 1,
  containsLegos: ['S0001L01'],
};

const mockSeed: SeedPair = {
  seed_id: 'S0001',
  seed_pair: { known: 'hello world', target: '你好世界' },
  legos: [mockLego],
};

const mockLearningItem: LearningItem = {
  lego: mockLego,
  phrase: mockPhrase,
  seed: mockSeed,
  thread_id: 1,
  mode: 'introduction',
};

const defaultConfig: CycleConfig = {
  pause_duration_ms: 3000,
  min_pause_ms: 1000,
  max_pause_ms: 10000,
  transition_gap_ms: 500,
  pause_adapts_to_phrase_length: false,
};

// ============================================
// MOCK AUDIO CONTROLLER
// ============================================

const createMockAudioController = (): IAudioController => ({
  play: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  preload: vi.fn().mockResolvedValue(undefined),
  isPreloaded: vi.fn().mockReturnValue(true),
  isPlaying: vi.fn().mockReturnValue(false),
  getCurrentTime: vi.fn().mockReturnValue(0),
  onEnded: vi.fn(),
  offEnded: vi.fn(),
});

// ============================================
// TEST HELPERS
// ============================================

/**
 * Get the most recently registered onEnded handler
 */
const getLatestOnEndedHandler = (audioController: IAudioController): (() => void) => {
  const calls = vi.mocked(audioController.onEnded).mock.calls;
  if (calls.length === 0) {
    throw new Error('No onEnded handlers registered');
  }
  return calls[calls.length - 1][0];
};

// ============================================
// TEST SUITE
// ============================================

describe('CycleOrchestrator', () => {
  let orchestrator: CycleOrchestrator;
  let mockAudioController: IAudioController;
  let config: CycleConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    config = { ...defaultConfig };
    mockAudioController = createMockAudioController();
    orchestrator = new CycleOrchestrator(mockAudioController, config);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ============================================
  // INITIALIZATION TESTS
  // ============================================

  describe('Initialization', () => {
    it('should initialize with IDLE phase', () => {
      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.IDLE);
      expect(state.currentItem).toBeNull();
      expect(state.isPlaying).toBe(false);
      expect(state.itemIndex).toBe(0);
    });

    it('should initialize with default pause duration from config', () => {
      const state = orchestrator.getState();
      expect(state.pauseDuration).toBe(3000);
    });

    it('should return a copy of state (not mutable reference)', () => {
      const state1 = orchestrator.getState();
      const state2 = orchestrator.getState();
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  // ============================================
  // PHASE TRANSITION TESTS
  // ============================================

  describe('Phase Transitions', () => {
    it('should transition through all phases: IDLE → PROMPT → PAUSE → VOICE_1 → VOICE_2 → TRANSITION', async () => {
      const phases: CyclePhase[] = [];
      const listener: CycleEventListener = (event) => {
        if (event.type === 'phase_changed') {
          phases.push(event.data?.newPhase as CyclePhase);
        }
      };
      orchestrator.addEventListener(listener);

      // Start the item
      const startPromise = orchestrator.startItem(mockLearningItem);

      // Simulate audio completion for PROMPT phase
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      // Wait for PAUSE timer
      await vi.runAllTimersAsync();

      // Simulate audio completion for VOICE_1 phase
      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      // Simulate audio completion for VOICE_2 phase
      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      // Wait for TRANSITION timer
      await vi.runAllTimersAsync();

      await startPromise;

      expect(phases).toEqual([
        Phase.PROMPT,
        Phase.PAUSE,
        Phase.VOICE_1,
        Phase.VOICE_2,
        Phase.TRANSITION,
      ]);
    });

    it('should emit phase_changed events with correct previousPhase and newPhase', async () => {
      const phaseChanges: Array<{ previous: CyclePhase; new: CyclePhase }> = [];
      const listener: CycleEventListener = (event) => {
        if (event.type === 'phase_changed') {
          phaseChanges.push({
            previous: event.data?.previousPhase as CyclePhase,
            new: event.data?.newPhase as CyclePhase,
          });
        }
      };
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);

      // Advance through first transition
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      expect(phaseChanges[0]).toEqual({ previous: Phase.IDLE, new: Phase.PROMPT });
      expect(phaseChanges[1]).toEqual({ previous: Phase.PROMPT, new: Phase.PAUSE });
    });

    it('should return to IDLE after completing all phases', async () => {
      const startPromise = orchestrator.startItem(mockLearningItem);

      // Complete all phases
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      await vi.runAllTimersAsync();
      await startPromise;

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.IDLE);
      expect(state.isPlaying).toBe(false);
      expect(state.currentItem).toBeNull();
    });
  });

  // ============================================
  // TEXT VISIBILITY TESTS
  // ============================================

  describe('Text Visibility', () => {
    it('should show no text in IDLE phase', () => {
      const visibility = orchestrator.getTextVisibility();
      expect(visibility).toEqual({ known: false, target: false });
    });

    it('should show only known text in PROMPT phase', async () => {
      orchestrator.startItem(mockLearningItem);
      const visibility = orchestrator.getTextVisibility();
      expect(visibility).toEqual({ known: true, target: false });
    });

    it('should show only known text in PAUSE phase', async () => {
      orchestrator.startItem(mockLearningItem);
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const visibility = orchestrator.getTextVisibility();
      expect(visibility).toEqual({ known: true, target: false });
    });

    it('should show only known text in VOICE_1 phase', async () => {
      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      const visibility = orchestrator.getTextVisibility();
      expect(visibility).toEqual({ known: true, target: false });
    });

    it('should show both known and target text in VOICE_2 phase', async () => {
      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const visibility = orchestrator.getTextVisibility();
      expect(visibility).toEqual({ known: true, target: true });
    });

    it('should show no text in TRANSITION phase', async () => {
      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const visibility = orchestrator.getTextVisibility();
      expect(visibility).toEqual({ known: false, target: false });
    });
  });

  // ============================================
  // EVENT EMISSION TESTS
  // ============================================

  describe('Event Emission', () => {
    it('should emit item_started event when starting an item', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);

      const itemStartedEvent = events.find((e) => e.type === 'item_started');
      expect(itemStartedEvent).toBeDefined();
      expect(itemStartedEvent?.data?.item).toEqual(mockLearningItem);
    });

    it('should emit audio_started and audio_completed events for known audio', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);

      const audioStartedEvent = events.find(
        (e) => e.type === 'audio_started' && e.data?.audioType === 'known'
      );
      expect(audioStartedEvent).toBeDefined();

      // Complete the audio
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const audioCompletedEvent = events.find(
        (e) => e.type === 'audio_completed' && e.data?.audioType === 'known'
      );
      expect(audioCompletedEvent).toBeDefined();
    });

    it('should emit pause_started event with duration', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const pauseStartedEvent = events.find((e) => e.type === 'pause_started');
      expect(pauseStartedEvent).toBeDefined();
      expect(pauseStartedEvent?.data?.duration).toBe(3000);
    });

    it('should emit audio events for target_voice1', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      const audioStartedEvent = events.find(
        (e) => e.type === 'audio_started' && e.data?.audioType === 'target_voice1'
      );
      expect(audioStartedEvent).toBeDefined();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const audioCompletedEvent = events.find(
        (e) => e.type === 'audio_completed' && e.data?.audioType === 'target_voice1'
      );
      expect(audioCompletedEvent).toBeDefined();
    });

    it('should emit audio events for target_voice2', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const audioStartedEvent = events.find(
        (e) => e.type === 'audio_started' && e.data?.audioType === 'target_voice2'
      );
      expect(audioStartedEvent).toBeDefined();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const audioCompletedEvent = events.find(
        (e) => e.type === 'audio_completed' && e.data?.audioType === 'target_voice2'
      );
      expect(audioCompletedEvent).toBeDefined();
    });

    it('should emit item_completed event with timing data', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);

      // Complete all phases
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      await vi.runAllTimersAsync();

      const itemCompletedEvent = events.find((e) => e.type === 'item_completed');
      expect(itemCompletedEvent).toBeDefined();
      expect(itemCompletedEvent?.data?.item).toEqual(mockLearningItem);
      expect(itemCompletedEvent?.data?.pauseStartTime).toBeDefined();
      expect(itemCompletedEvent?.data?.completedAt).toBeDefined();
    });

    it('should include timestamp in all events', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);

      events.forEach((event) => {
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe('number');
      });
    });

    it('should include current phase in all events', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);

      events.forEach((event) => {
        expect(event.phase).toBeDefined();
        expect(Object.values(Phase)).toContain(event.phase);
      });
    });
  });

  // ============================================
  // LISTENER MANAGEMENT TESTS
  // ============================================

  describe('Event Listener Management', () => {
    it('should allow adding multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      orchestrator.addEventListener(listener1);
      orchestrator.addEventListener(listener2);

      orchestrator.startItem(mockLearningItem);

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should allow removing listeners', () => {
      const listener = vi.fn();

      orchestrator.addEventListener(listener);
      orchestrator.removeEventListener(listener);

      orchestrator.startItem(mockLearningItem);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should not throw if removing a listener that was never added', () => {
      const listener = vi.fn();
      expect(() => orchestrator.removeEventListener(listener)).not.toThrow();
    });

    it('should handle listener errors gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorListener: CycleEventListener = () => {
        throw new Error('Listener error');
      };
      const normalListener = vi.fn();

      orchestrator.addEventListener(errorListener);
      orchestrator.addEventListener(normalListener);

      orchestrator.startItem(mockLearningItem);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(normalListener).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  // ============================================
  // ADAPTIVE PAUSE DURATION TESTS
  // ============================================

  describe('Adaptive Pause Duration', () => {
    it('should use default pause duration when adaptation is disabled', async () => {
      const longPhrase: PracticePhrase = {
        ...mockPhrase,
        wordCount: 10,
      };
      const longItem: LearningItem = {
        ...mockLearningItem,
        phrase: longPhrase,
      };

      orchestrator.startItem(longItem);

      const state = orchestrator.getState();
      expect(state.pauseDuration).toBe(3000);
    });

    it('should adapt pause duration based on word count when enabled', async () => {
      config.pause_adapts_to_phrase_length = true;
      orchestrator = new CycleOrchestrator(mockAudioController, config);

      const shortPhrase: PracticePhrase = {
        ...mockPhrase,
        wordCount: 1,
      };
      const shortItem: LearningItem = {
        ...mockLearningItem,
        phrase: shortPhrase,
      };

      orchestrator.startItem(shortItem);

      const state = orchestrator.getState();
      // 1 word: baseMs + (max(0, 1-3) * 300) = 3000 + 0 = 3000
      expect(state.pauseDuration).toBe(3000);
    });

    it('should increase pause duration for longer phrases', async () => {
      config.pause_adapts_to_phrase_length = true;
      orchestrator = new CycleOrchestrator(mockAudioController, config);

      const longPhrase: PracticePhrase = {
        ...mockPhrase,
        wordCount: 8,
      };
      const longItem: LearningItem = {
        ...mockLearningItem,
        phrase: longPhrase,
      };

      orchestrator.startItem(longItem);

      const state = orchestrator.getState();
      // 8 words: baseMs + (max(0, 8-3) * 300) = 3000 + (5 * 300) = 4500
      expect(state.pauseDuration).toBe(4500);
    });

    it('should clamp pause duration to min_pause_ms', async () => {
      config.pause_adapts_to_phrase_length = true;
      config.pause_duration_ms = 500; // Very short base
      config.min_pause_ms = 1000;
      orchestrator = new CycleOrchestrator(mockAudioController, config);

      orchestrator.startItem(mockLearningItem);

      const state = orchestrator.getState();
      expect(state.pauseDuration).toBe(1000);
    });

    it('should clamp pause duration to max_pause_ms', async () => {
      config.pause_adapts_to_phrase_length = true;
      config.max_pause_ms = 5000;
      orchestrator = new CycleOrchestrator(mockAudioController, config);

      const veryLongPhrase: PracticePhrase = {
        ...mockPhrase,
        wordCount: 50,
      };
      const veryLongItem: LearningItem = {
        ...mockLearningItem,
        phrase: veryLongPhrase,
      };

      orchestrator.startItem(veryLongItem);

      const state = orchestrator.getState();
      // Would be 3000 + (47 * 300) = 17100, but clamped to 5000
      expect(state.pauseDuration).toBe(5000);
    });
  });

  // ============================================
  // STOP CONTROL TESTS
  // ============================================

  describe('Stop Control', () => {
    it('should stop playback and return to IDLE', async () => {
      orchestrator.startItem(mockLearningItem);

      orchestrator.stop();

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.IDLE);
      expect(state.isPlaying).toBe(false);
    });

    it('should call audio controller stop', async () => {
      orchestrator.startItem(mockLearningItem);

      orchestrator.stop();

      expect(mockAudioController.stop).toHaveBeenCalled();
    });

    it('should clear pause timer when stopped', async () => {
      orchestrator.startItem(mockLearningItem);
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      orchestrator.stop();

      // If timer wasn't cleared, this would advance to next phase
      await vi.runAllTimersAsync();

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.IDLE);
    });

    it('should remove audio ended handler when stopped', async () => {
      orchestrator.startItem(mockLearningItem);

      orchestrator.stop();

      expect(mockAudioController.offEnded).toHaveBeenCalled();
    });

    it('should emit cycle_stopped event', async () => {
      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);
      orchestrator.stop();

      const stoppedEvent = events.find((e) => e.type === 'cycle_stopped');
      expect(stoppedEvent).toBeDefined();
    });

    it('should be safe to call stop when already idle', () => {
      expect(() => orchestrator.stop()).not.toThrow();
      expect(orchestrator.getState().phase).toBe(Phase.IDLE);
    });
  });

  // ============================================
  // SKIP PHASE TESTS
  // ============================================

  describe('Skip Phase Control', () => {
    it('should advance to next phase when skipPhase is called', async () => {
      orchestrator.startItem(mockLearningItem);

      orchestrator.skipPhase();

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.PAUSE);
    });

    it('should clear pause timer when skipping pause phase', async () => {
      orchestrator.startItem(mockLearningItem);
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      orchestrator.skipPhase();

      await vi.runAllTimersAsync();

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.VOICE_1);
    });

    it('should stop audio when skipping audio phase', async () => {
      orchestrator.startItem(mockLearningItem);

      orchestrator.skipPhase();

      expect(mockAudioController.stop).toHaveBeenCalled();
    });

    it('should do nothing if called when not playing', () => {
      orchestrator.skipPhase();

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.IDLE);
    });

    it('should do nothing if no current item', () => {
      const state = orchestrator.getState();
      state.isPlaying = true; // Manually set for edge case test

      orchestrator.skipPhase();

      expect(orchestrator.getState().phase).toBe(Phase.IDLE);
    });

    it('should allow skipping through all phases', async () => {
      orchestrator.startItem(mockLearningItem);

      orchestrator.skipPhase(); // PROMPT -> PAUSE
      orchestrator.skipPhase(); // PAUSE -> VOICE_1
      orchestrator.skipPhase(); // VOICE_1 -> VOICE_2
      orchestrator.skipPhase(); // VOICE_2 -> TRANSITION

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.TRANSITION);
    });
  });

  // ============================================
  // CONFIG UPDATE TESTS
  // ============================================

  describe('Configuration Updates', () => {
    it('should allow updating config', () => {
      orchestrator.updateConfig({ pause_duration_ms: 5000 });

      orchestrator.startItem(mockLearningItem);

      const state = orchestrator.getState();
      expect(state.pauseDuration).toBe(5000);
    });

    it('should merge partial config updates', () => {
      orchestrator.updateConfig({ pause_duration_ms: 5000 });
      orchestrator.updateConfig({ transition_gap_ms: 1000 });

      orchestrator.startItem(mockLearningItem);

      const state = orchestrator.getState();
      expect(state.pauseDuration).toBe(5000);
      // transition_gap_ms is used internally but not exposed in state
    });

    it('should apply updated config to subsequent items', () => {
      orchestrator.startItem(mockLearningItem);
      const firstState = orchestrator.getState();
      expect(firstState.pauseDuration).toBe(3000);

      orchestrator.stop();

      orchestrator.updateConfig({ pause_duration_ms: 7000 });
      orchestrator.startItem(mockLearningItem);

      const secondState = orchestrator.getState();
      expect(secondState.pauseDuration).toBe(7000);
    });
  });

  // ============================================
  // AUDIO PLAYBACK TESTS
  // ============================================

  describe('Audio Playback', () => {
    it('should play known audio in PROMPT phase', async () => {
      orchestrator.startItem(mockLearningItem);

      expect(mockAudioController.play).toHaveBeenCalledWith(
        mockLearningItem.phrase.audioRefs.known
      );
    });

    it('should play target voice1 audio in VOICE_1 phase', async () => {
      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      expect(mockAudioController.play).toHaveBeenCalledWith(
        mockLearningItem.phrase.audioRefs.target.voice1
      );
    });

    it('should play target voice2 audio in VOICE_2 phase', async () => {
      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      expect(mockAudioController.play).toHaveBeenCalledWith(
        mockLearningItem.phrase.audioRefs.target.voice2
      );
    });

    it('should set up audio ended handler before playing', async () => {
      orchestrator.startItem(mockLearningItem);

      // Check that onEnded was called at least once
      expect(mockAudioController.onEnded).toHaveBeenCalled();
      expect(mockAudioController.play).toHaveBeenCalled();
    });

    it('should remove previous audio handler before setting new one', async () => {
      orchestrator.startItem(mockLearningItem);

      const firstHandler = getLatestOnEndedHandler(mockAudioController);
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      // When moving to VOICE_1, should remove PROMPT handler
      expect(mockAudioController.offEnded).toHaveBeenCalledWith(firstHandler);
    });
  });

  // ============================================
  // ERROR HANDLING TESTS
  // ============================================

  describe('Error Handling', () => {
    it('should emit error event when audio playback fails in PROMPT', async () => {
      const audioError = new Error('Audio failed to load');
      vi.mocked(mockAudioController.play).mockRejectedValueOnce(audioError);

      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      await orchestrator.startItem(mockLearningItem);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.data?.error).toBe(audioError);
      expect(errorEvent?.data?.phase).toBe(Phase.PROMPT);
    });

    it('should continue to next phase even after audio error', async () => {
      vi.mocked(mockAudioController.play).mockRejectedValueOnce(new Error('Audio error'));

      await orchestrator.startItem(mockLearningItem);

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.PAUSE);
    });

    it('should emit error event when audio playback fails in VOICE_1', async () => {
      const audioError = new Error('Voice1 audio failed');
      vi.mocked(mockAudioController.play)
        .mockResolvedValueOnce(undefined) // PROMPT succeeds
        .mockRejectedValueOnce(audioError); // VOICE_1 fails

      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      const errorEvent = events.find(
        (e) => e.type === 'error' && e.data?.phase === Phase.VOICE_1
      );
      expect(errorEvent).toBeDefined();
    });

    it('should emit error event when audio playback fails in VOICE_2', async () => {
      const audioError = new Error('Voice2 audio failed');
      vi.mocked(mockAudioController.play)
        .mockResolvedValueOnce(undefined) // PROMPT
        .mockResolvedValueOnce(undefined) // VOICE_1
        .mockRejectedValueOnce(audioError); // VOICE_2 fails

      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      // Wait for async error to be processed
      await vi.runAllTimersAsync();

      const errorEvent = events.find(
        (e) => e.type === 'error' && e.data?.phase === Phase.VOICE_2
      );
      expect(errorEvent).toBeDefined();
    });
  });

  // ============================================
  // STATE MANAGEMENT TESTS
  // ============================================

  describe('State Management', () => {
    it('should increment itemIndex when starting new items', () => {
      const initialState = orchestrator.getState();
      expect(initialState.itemIndex).toBe(0);

      orchestrator.startItem(mockLearningItem);
      expect(orchestrator.getState().itemIndex).toBe(1);

      orchestrator.stop();

      orchestrator.startItem(mockLearningItem);
      expect(orchestrator.getState().itemIndex).toBe(2);
    });

    it('should set pauseStartTime when entering PAUSE phase', async () => {
      orchestrator.startItem(mockLearningItem);
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      const state = orchestrator.getState();
      expect(state.pauseStartTime).toBeDefined();
      expect(typeof state.pauseStartTime).toBe('number');
    });

    it('should set currentItem when starting', () => {
      orchestrator.startItem(mockLearningItem);

      const state = orchestrator.getState();
      expect(state.currentItem).toEqual(mockLearningItem);
    });

    it('should clear currentItem when completing', async () => {
      orchestrator.startItem(mockLearningItem);

      // Complete all phases
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      await vi.runAllTimersAsync();

      const state = orchestrator.getState();
      expect(state.currentItem).toBeNull();
    });

    it('should set isPlaying to true when starting', () => {
      orchestrator.startItem(mockLearningItem);

      const state = orchestrator.getState();
      expect(state.isPlaying).toBe(true);
    });

    it('should set isPlaying to false when stopping', () => {
      orchestrator.startItem(mockLearningItem);
      orchestrator.stop();

      const state = orchestrator.getState();
      expect(state.isPlaying).toBe(false);
    });
  });

  // ============================================
  // CLEANUP TESTS
  // ============================================

  describe('Cleanup', () => {
    it('should cleanup when starting a new item while one is playing', () => {
      orchestrator.startItem(mockLearningItem);

      const firstHandler = getLatestOnEndedHandler(mockAudioController);

      orchestrator.startItem(mockLearningItem);

      expect(mockAudioController.stop).toHaveBeenCalled();
      expect(mockAudioController.offEnded).toHaveBeenCalledWith(firstHandler);
    });

    it('should clear all timers during cleanup', async () => {
      orchestrator.startItem(mockLearningItem);
      const handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      orchestrator.stop();

      // Should not advance even after running timers
      await vi.runAllTimersAsync();

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.IDLE);
    });
  });

  // ============================================
  // TRANSITION GAP TESTS
  // ============================================

  describe('Transition Phase', () => {
    it('should use transition_gap_ms for transition phase', async () => {
      config.transition_gap_ms = 1000;
      orchestrator = new CycleOrchestrator(mockAudioController, config);

      const events: CycleEvent[] = [];
      const listener: CycleEventListener = (event) => events.push(event);
      orchestrator.addEventListener(listener);

      orchestrator.startItem(mockLearningItem);

      // Complete all phases
      let handler = getLatestOnEndedHandler(mockAudioController);
      handler();
      await vi.runAllTimersAsync();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      handler = getLatestOnEndedHandler(mockAudioController);
      handler();

      // Should still be in TRANSITION
      expect(orchestrator.getState().phase).toBe(Phase.TRANSITION);

      // Advance transition timer
      await vi.advanceTimersByTimeAsync(1000);

      // Should now be completed
      const itemCompletedEvent = events.find((e) => e.type === 'item_completed');
      expect(itemCompletedEvent).toBeDefined();
    });
  });

  // ============================================
  // EDGE CASES
  // ============================================

  describe('Edge Cases', () => {
    it('should handle rapid stop/start cycles', () => {
      orchestrator.startItem(mockLearningItem);
      orchestrator.stop();
      orchestrator.startItem(mockLearningItem);
      orchestrator.stop();
      orchestrator.startItem(mockLearningItem);

      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.PROMPT);
      expect(state.isPlaying).toBe(true);
    });

    it('should handle multiple skipPhase calls in succession', () => {
      orchestrator.startItem(mockLearningItem);

      for (let i = 0; i < 10; i++) {
        orchestrator.skipPhase();
      }

      // Should be in TRANSITION (last phase before complete)
      const state = orchestrator.getState();
      expect(state.phase).toBe(Phase.TRANSITION);
    });

    it('should handle starting item with minimal config values', () => {
      config.pause_duration_ms = 0;
      config.min_pause_ms = 0;
      config.max_pause_ms = 0;
      config.transition_gap_ms = 0;
      orchestrator = new CycleOrchestrator(mockAudioController, config);

      expect(() => orchestrator.startItem(mockLearningItem)).not.toThrow();
    });

    it('should handle item with no audioRefs gracefully', async () => {
      const itemWithNoAudio: LearningItem = {
        ...mockLearningItem,
        phrase: {
          ...mockPhrase,
          audioRefs: {
            known: { id: '', url: '' },
            target: {
              voice1: { id: '', url: '' },
              voice2: { id: '', url: '' },
            },
          },
        },
      };

      // Should not throw
      await expect(orchestrator.startItem(itemWithNoAudio)).resolves.not.toThrow();
    });
  });
});
