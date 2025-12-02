/**
 * ThreadIndicator - Triple Helix Visualization
 *
 * Shows the three interweaving threads of the learning system.
 * The active thread glows while others remain subtle, creating
 * a DNA-like visual metaphor for how learning strands combine.
 */

import React from 'react';
import { motion } from 'framer-motion';
import './ThreadIndicator.css';

export interface ThreadIndicatorProps {
  /** Which thread is currently active (1, 2, or 3) */
  activeThread: number;
  /** Whether to show labels */
  showLabels?: boolean;
}

const threadColors = [
  { active: 'var(--ssi-glow-primary)', inactive: 'var(--ssi-glow-soft)' },
  { active: 'var(--ssi-ambient-purple)', inactive: 'rgba(167, 139, 250, 0.2)' },
  { active: 'var(--ssi-ambient-blue)', inactive: 'rgba(96, 165, 250, 0.2)' },
];

export function ThreadIndicator({ activeThread, showLabels = false }: ThreadIndicatorProps) {
  return (
    <div className="thread-indicator">
      <div className="thread-indicator__helix">
        {[1, 2, 3].map((thread, index) => {
          const isActive = thread === activeThread;
          const colors = threadColors[index];

          return (
            <motion.div
              key={thread}
              className={`thread-indicator__strand ${isActive ? 'thread-indicator__strand--active' : ''}`}
              animate={{
                scale: isActive ? 1 : 0.85,
                opacity: isActive ? 1 : 0.4,
              }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              {/* Thread dot */}
              <motion.div
                className="thread-indicator__dot"
                style={{
                  background: isActive ? colors.active : colors.inactive,
                  boxShadow: isActive ? `0 0 12px ${colors.active}` : 'none',
                }}
                animate={
                  isActive
                    ? {
                        scale: [1, 1.2, 1],
                        boxShadow: [
                          `0 0 12px ${colors.active}`,
                          `0 0 20px ${colors.active}`,
                          `0 0 12px ${colors.active}`,
                        ],
                      }
                    : {}
                }
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Connecting line to next dot */}
              {index < 2 && (
                <div
                  className="thread-indicator__connector"
                  style={{
                    background: `linear-gradient(90deg, ${
                      isActive ? colors.active : colors.inactive
                    } 0%, ${
                      activeThread === thread + 1
                        ? threadColors[index + 1].active
                        : threadColors[index + 1].inactive
                    } 100%)`,
                    opacity: isActive || activeThread === thread + 1 ? 0.6 : 0.2,
                  }}
                />
              )}

              {/* Label */}
              {showLabels && (
                <motion.span
                  className="thread-indicator__label"
                  animate={{ opacity: isActive ? 1 : 0.3 }}
                  style={{ color: isActive ? colors.active : 'var(--ssi-white-30)' }}
                >
                  {thread}
                </motion.span>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Helix twist effect */}
      <svg
        className="thread-indicator__twist"
        width="100"
        height="24"
        viewBox="0 0 100 24"
        fill="none"
      >
        <defs>
          <linearGradient id="helix-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--ssi-glow-primary)" stopOpacity="0.3" />
            <stop offset="50%" stopColor="var(--ssi-ambient-purple)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--ssi-ambient-blue)" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* DNA-like wave */}
        <motion.path
          d="M0 12 Q25 2, 50 12 T100 12"
          stroke="url(#helix-gradient)"
          strokeWidth="1"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.5 }}
          transition={{ duration: 1, delay: 0.2 }}
        />
        <motion.path
          d="M0 12 Q25 22, 50 12 T100 12"
          stroke="url(#helix-gradient)"
          strokeWidth="1"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.5 }}
          transition={{ duration: 1, delay: 0.4 }}
        />
      </svg>
    </div>
  );
}

export default ThreadIndicator;
