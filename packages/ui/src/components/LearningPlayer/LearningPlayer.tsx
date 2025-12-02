/**
 * LearningPlayer - The Heart of SSi
 *
 * A mesmerizing, immersive learning interface that makes
 * language acquisition feel like meditation. The UI breathes
 * with the rhythm of learning.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CyclePhase, type LearningItem, type LanguagePair } from '@ssi/core';
import { WaveformVisualizer } from './WaveformVisualizer';
import { PhraseDisplay } from './PhraseDisplay';
import { ThreadIndicator } from './ThreadIndicator';
import { ProgressRing } from './ProgressRing';
import './LearningPlayer.css';

export interface LearningPlayerProps {
  /** Current learning item */
  item: LearningItem | null;
  /** Current phase of the cycle */
  phase: CyclePhase;
  /** Current thread (1, 2, or 3) */
  activeThread: number;
  /** Session progress (0-1) */
  sessionProgress: number;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Items practiced in session */
  itemsPracticed: number;
  /** Total estimated items */
  totalItems: number;
  /** Callback when user wants to skip */
  onSkip?: () => void;
  /** Callback when user wants to stop */
  onStop?: () => void;
  /** Current phrase text to display */
  phrase?: LanguagePair;
  /** Whether target should be visible */
  showTarget?: boolean;
}

const phaseConfig: Record<CyclePhase, { label: string; color: string }> = {
  [CyclePhase.IDLE]: { label: 'Ready', color: 'var(--ssi-white-50)' },
  [CyclePhase.PROMPT]: { label: 'Listen', color: 'var(--ssi-glow-primary)' },
  [CyclePhase.PAUSE]: { label: 'Speak', color: 'var(--ssi-coral-400)' },
  [CyclePhase.VOICE_1]: { label: 'Check', color: 'var(--ssi-ambient-purple)' },
  [CyclePhase.VOICE_2]: { label: 'Confirm', color: 'var(--ssi-ambient-blue)' },
  [CyclePhase.TRANSITION]: { label: '...', color: 'var(--ssi-white-30)' },
};

export function LearningPlayer({
  item,
  phase,
  activeThread,
  sessionProgress,
  isPlaying,
  itemsPracticed,
  totalItems,
  onSkip,
  onStop,
  phrase,
  showTarget = false,
}: LearningPlayerProps) {
  const [breatheScale, setBreatheScale] = useState(1);

  // Breathing animation synced with learning rhythm
  useEffect(() => {
    if (phase === CyclePhase.PAUSE) {
      // Faster breathing during pause (user speaking)
      const interval = setInterval(() => {
        setBreatheScale((s) => (s === 1 ? 1.02 : 1));
      }, 1500);
      return () => clearInterval(interval);
    } else {
      setBreatheScale(1);
    }
  }, [phase]);

  const currentPhaseConfig = phaseConfig[phase] || phaseConfig[CyclePhase.IDLE];

  return (
    <div className="ssi-player">
      {/* Ambient Background */}
      <div className="ssi-player__ambient">
        <motion.div
          className="ssi-player__orb ssi-player__orb--1"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="ssi-player__orb ssi-player__orb--2"
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.2, 0.4, 0.2],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="ssi-player__orb ssi-player__orb--3"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.15, 0.3, 0.15],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      {/* Thread Indicator - Triple Helix */}
      <div className="ssi-player__threads">
        <ThreadIndicator activeThread={activeThread} />
      </div>

      {/* Main Content Area */}
      <motion.div
        className="ssi-player__main"
        animate={{ scale: breatheScale }}
        transition={{ duration: 0.8, ease: 'easeInOut' }}
      >
        {/* Central Ring - Progress & Phase */}
        <div className="ssi-player__ring-container">
          <ProgressRing
            progress={sessionProgress}
            phase={phase}
            isPlaying={isPlaying}
          />

          {/* Phase Indicator */}
          <motion.div
            className="ssi-player__phase"
            key={phase}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <span
              className="ssi-player__phase-label"
              style={{ color: currentPhaseConfig.color }}
            >
              {currentPhaseConfig.label}
            </span>
          </motion.div>
        </div>

        {/* Phrase Display */}
        <AnimatePresence mode="wait">
          {phrase && (
            <PhraseDisplay
              key={phrase.known + phrase.target}
              known={phrase.known}
              target={phrase.target}
              showTarget={showTarget}
              phase={phase}
            />
          )}
        </AnimatePresence>

        {/* Waveform Visualizer */}
        <div className="ssi-player__waveform">
          <WaveformVisualizer
            isActive={isPlaying && phase !== CyclePhase.PAUSE}
            phase={phase}
          />
        </div>
      </motion.div>

      {/* Session Stats */}
      <div className="ssi-player__stats">
        <div className="ssi-player__stat">
          <span className="ssi-player__stat-value">{itemsPracticed}</span>
          <span className="ssi-player__stat-label">practiced</span>
        </div>
        <div className="ssi-player__stat-divider" />
        <div className="ssi-player__stat">
          <span className="ssi-player__stat-value">
            {Math.round(sessionProgress * 100)}%
          </span>
          <span className="ssi-player__stat-label">session</span>
        </div>
      </div>

      {/* Controls */}
      <div className="ssi-player__controls">
        <motion.button
          className="ssi-player__control ssi-player__control--stop"
          onClick={onStop}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          <span>End Session</span>
        </motion.button>
      </div>
    </div>
  );
}

export default LearningPlayer;
