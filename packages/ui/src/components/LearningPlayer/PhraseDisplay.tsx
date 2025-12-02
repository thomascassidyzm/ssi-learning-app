/**
 * PhraseDisplay - Elegant Language Presentation
 *
 * Displays the known and target language phrases with beautiful
 * typography and smooth reveal animations. The target language
 * can be hidden during the pause phase for active recall.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CyclePhase } from '@ssi/core';
import './PhraseDisplay.css';

export interface PhraseDisplayProps {
  /** The phrase in the known language */
  known: string;
  /** The phrase in the target language */
  target: string;
  /** Whether to show the target language */
  showTarget: boolean;
  /** Current cycle phase */
  phase: CyclePhase;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: { duration: 0.3 },
  },
};

const phraseVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.33, 1, 0.68, 1],
    },
  },
};

const targetRevealVariants = {
  hidden: {
    opacity: 0,
    filter: 'blur(8px)',
    y: 10,
  },
  visible: {
    opacity: 1,
    filter: 'blur(0px)',
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.33, 1, 0.68, 1],
    },
  },
};

export function PhraseDisplay({ known, target, showTarget, phase }: PhraseDisplayProps) {
  const isPausePhase = phase === CyclePhase.PAUSE;

  return (
    <motion.div
      className="phrase-display"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {/* Known language phrase */}
      <motion.div className="phrase-display__known" variants={phraseVariants}>
        <span className="phrase-display__text phrase-display__text--known">{known}</span>
      </motion.div>

      {/* Divider */}
      <motion.div
        className="phrase-display__divider"
        variants={phraseVariants}
        style={{
          background: isPausePhase
            ? 'linear-gradient(90deg, transparent, var(--ssi-coral-400), transparent)'
            : 'linear-gradient(90deg, transparent, var(--ssi-white-15), transparent)',
        }}
      />

      {/* Target language phrase */}
      <motion.div className="phrase-display__target" variants={phraseVariants}>
        <AnimatePresence mode="wait">
          {showTarget ? (
            <motion.span
              key="target-visible"
              className="phrase-display__text phrase-display__text--target"
              variants={targetRevealVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
            >
              {target}
            </motion.span>
          ) : (
            <motion.div
              key="target-hidden"
              className="phrase-display__placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.span
                className="phrase-display__prompt"
                animate={{
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                {isPausePhase ? 'Speak now...' : '...'}
              </motion.span>

              {/* Animated dots when hidden */}
              {isPausePhase && (
                <div className="phrase-display__listening">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="phrase-display__dot"
                      animate={{
                        scale: [1, 1.5, 1],
                        opacity: [0.3, 1, 0.3],
                      }}
                      transition={{
                        duration: 1,
                        repeat: Infinity,
                        delay: i * 0.2,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Ambient glow behind text */}
      <motion.div
        className="phrase-display__glow"
        animate={{
          opacity: showTarget ? [0.1, 0.2, 0.1] : [0.05, 0.1, 0.05],
          scale: showTarget ? 1 : 0.9,
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </motion.div>
  );
}

export default PhraseDisplay;
