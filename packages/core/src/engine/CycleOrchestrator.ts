/**
 * CycleOrchestrator - State machine for ONE prompt-response learning cycle
 *
 * 4-Phase Learning Cycle:
 * 1. PROMPT   - Show KNOWN text, play KNOWN audio
 * 2. PAUSE    - Learner attempts TARGET (KNOWN text stays visible, timed gap)
 * 3. VOICE_1  - Play TARGET audio (voice A), NO target text yet
 * 4. VOICE_2  - Play TARGET audio (voice B), TARGET text NOW appears
 */

import type { LearningItem } from '../data/types';
import type { CycleConfig } from '../config/types';
import {
  CyclePhase,
  CycleState,
  CycleEvent,
  CycleEventListener,
  TextVisibility,
  TEXT_VISIBILITY,
  IAudioController,
  ICycleOrchestrator,
} from './types';

export class CycleOrchestrator implements ICycleOrchestrator {
  private state: CycleState;
  private config: CycleConfig;
  private audioController: IAudioController;
  private listeners: Set<CycleEventListener> = new Set();
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private audioEndedHandler: (() => void) | null = null;

  constructor(audioController: IAudioController, config: CycleConfig) {
    this.audioController = audioController;
    this.config = config;
    this.state = this.createInitialState();
  }

  private createInitialState(): CycleState {
    return {
      phase: CyclePhase.IDLE,
      currentItem: null,
      pauseDuration: this.config.pause_duration_ms,
      pauseStartTime: null,
      isPlaying: false,
      itemIndex: 0,
      // Phase timestamps for timing analysis
      promptStartTime: null,
      promptEndTime: null,
      voice1StartTime: null,
    };
  }

  /**
   * Get current state (read-only copy)
   */
  getState(): CycleState {
    return { ...this.state };
  }

  /**
   * Update configuration (for adaptive changes)
   */
  updateConfig(config: Partial<CycleConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Start playing a learning item through all phases
   * @param item - The learning item to play
   * @param options - Optional per-item settings (pauseDuration overrides config)
   */
  async startItem(item: LearningItem, options?: { pauseDuration?: number }): Promise<void> {
    // Clean up any existing playback
    this.cleanup();

    // Set up state for new item
    this.state.currentItem = item;
    this.state.isPlaying = true;
    this.state.itemIndex++;

    // Use provided pause duration, or calculate from config
    if (options?.pauseDuration !== undefined) {
      this.state.pauseDuration = options.pauseDuration;
    } else {
      this.state.pauseDuration = this.calculatePauseDuration(item);
    }

    this.emit('item_started', { item });

    // Start the cycle
    await this.transitionTo(CyclePhase.PROMPT);
  }

  /**
   * Stop playback completely
   */
  stop(): void {
    this.cleanup();
    this.state.phase = CyclePhase.IDLE;
    this.state.isPlaying = false;
    this.emit('cycle_stopped', {});
  }

  /**
   * Skip to next phase (user control)
   */
  skipPhase(): void {
    if (!this.state.isPlaying || !this.state.currentItem) return;

    // Clear any pending timers/audio
    this.clearPauseTimer();
    this.audioController.stop();

    // Advance to next phase
    this.advancePhase();
  }

  /**
   * Get text visibility for current phase
   */
  getTextVisibility(): TextVisibility {
    return TEXT_VISIBILITY[this.state.phase];
  }

  /**
   * Add event listener
   */
  addEventListener(listener: CycleEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: CycleEventListener): void {
    this.listeners.delete(listener);
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async transitionTo(phase: CyclePhase): Promise<void> {
    const previousPhase = this.state.phase;
    this.state.phase = phase;

    this.emit('phase_changed', { previousPhase, newPhase: phase });

    switch (phase) {
      case CyclePhase.PROMPT:
        await this.handlePromptPhase();
        break;
      case CyclePhase.PAUSE:
        this.handlePausePhase();
        break;
      case CyclePhase.VOICE_1:
        await this.handleVoice1Phase();
        break;
      case CyclePhase.VOICE_2:
        await this.handleVoice2Phase();
        break;
      case CyclePhase.TRANSITION:
        this.handleTransitionPhase();
        break;
      case CyclePhase.IDLE:
        // Do nothing
        break;
    }
  }

  private async handlePromptPhase(): Promise<void> {
    const item = this.state.currentItem;
    if (!item) return;

    // Record prompt start time for timing analysis
    this.state.promptStartTime = performance.now();

    // Play KNOWN language audio
    const knownAudio = item.phrase.audioRefs.known;

    this.emit('audio_started', { audioType: 'known' });

    try {
      // Set up handler for when audio ends
      this.setupAudioEndedHandler(() => {
        // Record prompt end time for timing analysis
        this.state.promptEndTime = performance.now();

        this.emit('audio_completed', { audioType: 'known' });
        this.advancePhase();
      });

      await this.audioController.play(knownAudio);
    } catch (error) {
      // Still record prompt end time on error
      this.state.promptEndTime = performance.now();

      this.emit('error', { error, phase: CyclePhase.PROMPT });
      this.advancePhase(); // Continue even on error
    }
  }

  private handlePausePhase(): void {
    // Record when pause started (for latency measurement)
    this.state.pauseStartTime = Date.now();
    this.emit('pause_started', { duration: this.state.pauseDuration });

    // Set timer for pause duration
    this.pauseTimer = setTimeout(() => {
      this.advancePhase();
    }, this.state.pauseDuration);
  }

  private async handleVoice1Phase(): Promise<void> {
    const item = this.state.currentItem;
    if (!item) return;

    // Record voice1 start time for timing analysis
    this.state.voice1StartTime = performance.now();

    // Play TARGET language audio (voice 1)
    const targetAudio = item.phrase.audioRefs.target.voice1;

    this.emit('audio_started', { audioType: 'target_voice1' });

    try {
      this.setupAudioEndedHandler(() => {
        this.emit('audio_completed', { audioType: 'target_voice1' });
        this.advancePhase();
      });

      await this.audioController.play(targetAudio);
    } catch (error) {
      this.emit('error', { error, phase: CyclePhase.VOICE_1 });
      this.advancePhase();
    }
  }

  private async handleVoice2Phase(): Promise<void> {
    const item = this.state.currentItem;
    if (!item) return;

    // Play TARGET language audio (voice 2) - text NOW appears
    const targetAudio = item.phrase.audioRefs.target.voice2;

    this.emit('audio_started', { audioType: 'target_voice2' });

    try {
      this.setupAudioEndedHandler(() => {
        this.emit('audio_completed', { audioType: 'target_voice2' });
        this.advancePhase();
      });

      await this.audioController.play(targetAudio);
    } catch (error) {
      this.emit('error', { error, phase: CyclePhase.VOICE_2 });
      this.advancePhase();
    }
  }

  private handleTransitionPhase(): void {
    // Brief transition gap before completing
    // Track the timer so it can be cleared on stop()
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      this.completeItem();
    }, this.config.transition_gap_ms);
  }

  private advancePhase(): void {
    const phaseOrder: CyclePhase[] = [
      CyclePhase.PROMPT,
      CyclePhase.PAUSE,
      CyclePhase.VOICE_1,
      CyclePhase.VOICE_2,
      CyclePhase.TRANSITION,
    ];

    const currentIndex = phaseOrder.indexOf(this.state.phase);
    if (currentIndex < phaseOrder.length - 1) {
      this.transitionTo(phaseOrder[currentIndex + 1]);
    }
  }

  private completeItem(): void {
    const item = this.state.currentItem;

    this.emit('item_completed', {
      item,
      pauseStartTime: this.state.pauseStartTime,
      completedAt: Date.now(),
      // Include phase timestamps for timing analysis
      timingData: {
        promptStartTime: this.state.promptStartTime,
        promptEndTime: this.state.promptEndTime,
        voice1StartTime: this.state.voice1StartTime,
      },
    });

    // Reset to idle
    this.state.phase = CyclePhase.IDLE;
    this.state.currentItem = null;
    this.state.pauseStartTime = null;
    this.state.isPlaying = false;

    // Reset timing timestamps
    this.state.promptStartTime = null;
    this.state.promptEndTime = null;
    this.state.voice1StartTime = null;
  }

  private calculatePauseDuration(item: LearningItem): number {
    if (!this.config.pause_adapts_to_phrase_length) {
      return this.config.pause_duration_ms;
    }

    // Adapt pause duration based on phrase length
    const wordCount = item.phrase.wordCount;
    const baseMs = this.config.pause_duration_ms;

    // Add ~300ms per word beyond 3 words
    const extraWords = Math.max(0, wordCount - 3);
    const adaptedMs = baseMs + (extraWords * 300);

    // Clamp to min/max
    return Math.min(
      Math.max(adaptedMs, this.config.min_pause_ms),
      this.config.max_pause_ms
    );
  }

  private setupAudioEndedHandler(handler: () => void): void {
    // Remove previous handler
    if (this.audioEndedHandler) {
      this.audioController.offEnded(this.audioEndedHandler);
    }

    this.audioEndedHandler = handler;
    this.audioController.onEnded(handler);
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  private clearTransitionTimer(): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
  }

  private cleanup(): void {
    this.clearPauseTimer();
    this.clearTransitionTimer();
    this.audioController.stop();

    if (this.audioEndedHandler) {
      this.audioController.offEnded(this.audioEndedHandler);
      this.audioEndedHandler = null;
    }
  }

  private emit(type: CycleEvent['type'], data: Record<string, unknown>): void {
    const event: CycleEvent = {
      type,
      phase: this.state.phase,
      item: this.state.currentItem,
      timestamp: Date.now(),
      data,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in cycle event listener:', error);
      }
    }
  }
}
