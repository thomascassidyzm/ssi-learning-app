/**
 * WaveformVisualizer - Audio Visualization
 *
 * A mesmerizing waveform that responds to the learning phases.
 * When audio plays, the bars dance. During pause, they settle
 * into a gentle breathing pattern, inviting the learner to speak.
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { CyclePhase } from '@ssi/core';
import './WaveformVisualizer.css';

export interface WaveformVisualizerProps {
  /** Whether audio is currently active */
  isActive: boolean;
  /** Current learning phase */
  phase: CyclePhase;
  /** Number of bars in the waveform */
  barCount?: number;
}

const phaseColors: Record<CyclePhase, { primary: string; secondary: string }> = {
  [CyclePhase.IDLE]: {
    primary: 'var(--ssi-white-30)',
    secondary: 'var(--ssi-white-15)',
  },
  [CyclePhase.PROMPT]: {
    primary: 'var(--ssi-glow-primary)',
    secondary: 'var(--ssi-glow-soft)',
  },
  [CyclePhase.PAUSE]: {
    primary: 'var(--ssi-coral-400)',
    secondary: 'var(--ssi-coral-glow)',
  },
  [CyclePhase.VOICE_1]: {
    primary: 'var(--ssi-ambient-purple)',
    secondary: 'rgba(167, 139, 250, 0.3)',
  },
  [CyclePhase.VOICE_2]: {
    primary: 'var(--ssi-ambient-blue)',
    secondary: 'rgba(96, 165, 250, 0.3)',
  },
  [CyclePhase.TRANSITION]: {
    primary: 'var(--ssi-white-50)',
    secondary: 'var(--ssi-white-15)',
  },
};

export function WaveformVisualizer({
  isActive,
  phase,
  barCount = 32,
}: WaveformVisualizerProps) {
  const colors = phaseColors[phase] || phaseColors[CyclePhase.IDLE];

  // Generate random heights for each bar (seeded by index for consistency)
  const barHeights = useMemo(() => {
    return Array.from({ length: barCount }, (_, i) => {
      // Create a smooth wave pattern
      const center = barCount / 2;
      const distance = Math.abs(i - center) / center;
      const baseHeight = 0.3 + (1 - distance) * 0.7;
      // Add some randomness
      const random = Math.sin(i * 0.7) * 0.3 + 0.7;
      return baseHeight * random;
    });
  }, [barCount]);

  return (
    <div className="waveform">
      <div className="waveform__container">
        {barHeights.map((height, index) => {
          // Calculate animation delay based on distance from center
          const center = barCount / 2;
          const distanceFromCenter = Math.abs(index - center);
          const delay = distanceFromCenter * 0.02;

          return (
            <motion.div
              key={index}
              className="waveform__bar"
              style={{
                background: `linear-gradient(to top, ${colors.secondary}, ${colors.primary})`,
              }}
              animate={
                isActive
                  ? {
                      scaleY: [height * 0.5, height, height * 0.3, height * 0.8, height * 0.5],
                      opacity: [0.6, 1, 0.5, 0.9, 0.6],
                    }
                  : {
                      scaleY: [0.15, 0.25, 0.15],
                      opacity: [0.3, 0.5, 0.3],
                    }
              }
              transition={
                isActive
                  ? {
                      duration: 0.8 + Math.random() * 0.4,
                      repeat: Infinity,
                      delay,
                      ease: 'easeInOut',
                    }
                  : {
                      duration: 3,
                      repeat: Infinity,
                      delay: delay * 2,
                      ease: 'easeInOut',
                    }
              }
            />
          );
        })}
      </div>

      {/* Reflection */}
      <div className="waveform__reflection">
        {barHeights.map((height, index) => {
          const center = barCount / 2;
          const distanceFromCenter = Math.abs(index - center);
          const delay = distanceFromCenter * 0.02;

          return (
            <motion.div
              key={index}
              className="waveform__bar waveform__bar--reflection"
              style={{
                background: `linear-gradient(to bottom, ${colors.secondary}, transparent)`,
              }}
              animate={
                isActive
                  ? {
                      scaleY: [height * 0.3, height * 0.6, height * 0.2, height * 0.5, height * 0.3],
                      opacity: [0.15, 0.3, 0.1, 0.25, 0.15],
                    }
                  : {
                      scaleY: [0.1, 0.15, 0.1],
                      opacity: [0.1, 0.2, 0.1],
                    }
              }
              transition={
                isActive
                  ? {
                      duration: 0.8 + Math.random() * 0.4,
                      repeat: Infinity,
                      delay,
                      ease: 'easeInOut',
                    }
                  : {
                      duration: 3,
                      repeat: Infinity,
                      delay: delay * 2,
                      ease: 'easeInOut',
                    }
              }
            />
          );
        })}
      </div>

      {/* Center glow */}
      <motion.div
        className="waveform__glow"
        style={{
          background: `radial-gradient(ellipse at center, ${colors.secondary} 0%, transparent 70%)`,
        }}
        animate={{
          opacity: isActive ? [0.3, 0.6, 0.3] : [0.1, 0.2, 0.1],
          scale: isActive ? [1, 1.1, 1] : 1,
        }}
        transition={{
          duration: isActive ? 1.5 : 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}

export default WaveformVisualizer;
