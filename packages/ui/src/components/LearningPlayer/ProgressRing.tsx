/**
 * ProgressRing - Circular Progress with Phase-Aware Glow
 *
 * A mesmerizing SVG ring that shows session progress while
 * pulsing with the current learning phase. The ring breathes
 * with gentle animations, creating a meditative focal point.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { CyclePhase } from '@ssi/core';
import './ProgressRing.css';

export interface ProgressRingProps {
  /** Progress from 0 to 1 */
  progress: number;
  /** Current learning phase */
  phase: CyclePhase;
  /** Whether audio is playing */
  isPlaying: boolean;
  /** Ring size in pixels */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
}

const phaseColors: Record<CyclePhase, string> = {
  [CyclePhase.IDLE]: 'var(--ssi-white-30)',
  [CyclePhase.PROMPT]: 'var(--ssi-glow-primary)',
  [CyclePhase.PAUSE]: 'var(--ssi-coral-400)',
  [CyclePhase.VOICE_1]: 'var(--ssi-ambient-purple)',
  [CyclePhase.VOICE_2]: 'var(--ssi-ambient-blue)',
  [CyclePhase.TRANSITION]: 'var(--ssi-white-50)',
};

export function ProgressRing({
  progress,
  phase,
  isPlaying,
  size = 180,
  strokeWidth = 3,
}: ProgressRingProps) {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - progress * circumference;

  const color = phaseColors[phase] || phaseColors[CyclePhase.IDLE];

  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      {/* Glow Layer */}
      <motion.div
        className="progress-ring__glow"
        animate={{
          opacity: isPlaying ? [0.3, 0.6, 0.3] : 0.2,
          scale: isPlaying ? [1, 1.05, 1] : 1,
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        }}
      />

      {/* SVG Ring */}
      <svg
        className="progress-ring__svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Definitions for gradients and filters */}
        <defs>
          {/* Glow filter */}
          <filter id="ring-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Progress gradient */}
          <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--ssi-glow-secondary)" />
            <stop offset="50%" stopColor="var(--ssi-glow-primary)" />
            <stop offset="100%" stopColor="var(--ssi-glow-tertiary)" />
          </linearGradient>
        </defs>

        {/* Background track */}
        <circle
          className="progress-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ssi-white-08)"
          strokeWidth={strokeWidth}
        />

        {/* Progress arc */}
        <motion.circle
          className="progress-ring__progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#progress-gradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          filter="url(#ring-glow)"
          initial={false}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{
            transformOrigin: 'center',
            transform: 'rotate(-90deg)',
          }}
        />

        {/* Phase indicator dot */}
        {progress > 0 && (
          <motion.circle
            className="progress-ring__dot"
            cx={size / 2 + radius * Math.cos((progress * 360 - 90) * (Math.PI / 180))}
            cy={size / 2 + radius * Math.sin((progress * 360 - 90) * (Math.PI / 180))}
            r={strokeWidth * 2}
            fill={color}
            filter="url(#ring-glow)"
            animate={{
              scale: isPlaying ? [1, 1.3, 1] : 1,
              opacity: isPlaying ? [0.8, 1, 0.8] : 0.6,
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}
      </svg>

      {/* Inner glow ring */}
      <motion.div
        className="progress-ring__inner-glow"
        animate={{
          boxShadow: isPlaying
            ? [
                `inset 0 0 30px ${color}20`,
                `inset 0 0 50px ${color}30`,
                `inset 0 0 30px ${color}20`,
              ]
            : `inset 0 0 20px ${color}10`,
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        style={{
          width: size - strokeWidth * 4,
          height: size - strokeWidth * 4,
        }}
      />
    </div>
  );
}

export default ProgressRing;
