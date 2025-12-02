/**
 * SSi Learning Player Demo
 *
 * An interactive demo that cycles through all learning phases
 * to showcase the beautiful "Liquid Learning" interface.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CyclePhase } from '@ssi/core';
import { LearningPlayer } from '@ssi/ui';

// Demo phrases for showcasing
const demoPhases: Array<{
  phase: CyclePhase;
  duration: number;
  phrase: { known: string; target: string };
  showTarget: boolean;
}> = [
  {
    phase: CyclePhase.PROMPT,
    duration: 3000,
    phrase: { known: 'Hello, how are you?', target: 'Hola, ¿cómo estás?' },
    showTarget: false,
  },
  {
    phase: CyclePhase.PAUSE,
    duration: 4000,
    phrase: { known: 'Hello, how are you?', target: 'Hola, ¿cómo estás?' },
    showTarget: false,
  },
  {
    phase: CyclePhase.VOICE_1,
    duration: 2500,
    phrase: { known: 'Hello, how are you?', target: 'Hola, ¿cómo estás?' },
    showTarget: false,
  },
  {
    phase: CyclePhase.VOICE_2,
    duration: 2500,
    phrase: { known: 'Hello, how are you?', target: 'Hola, ¿cómo estás?' },
    showTarget: true,
  },
  {
    phase: CyclePhase.TRANSITION,
    duration: 1000,
    phrase: { known: '', target: '' },
    showTarget: false,
  },
  {
    phase: CyclePhase.PROMPT,
    duration: 3000,
    phrase: { known: 'I want to learn Spanish', target: 'Quiero aprender español' },
    showTarget: false,
  },
  {
    phase: CyclePhase.PAUSE,
    duration: 4000,
    phrase: { known: 'I want to learn Spanish', target: 'Quiero aprender español' },
    showTarget: false,
  },
  {
    phase: CyclePhase.VOICE_1,
    duration: 2500,
    phrase: { known: 'I want to learn Spanish', target: 'Quiero aprender español' },
    showTarget: false,
  },
  {
    phase: CyclePhase.VOICE_2,
    duration: 2500,
    phrase: { known: 'I want to learn Spanish', target: 'Quiero aprender español' },
    showTarget: true,
  },
];

function App() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [itemsPracticed, setItemsPracticed] = useState(0);
  const [activeThread, setActiveThread] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);

  const current = demoPhases[currentIndex];
  const sessionProgress = (currentIndex + 1) / demoPhases.length;

  // Auto-advance through phases
  useEffect(() => {
    if (!isPlaying) return;

    const timer = setTimeout(() => {
      const nextIndex = (currentIndex + 1) % demoPhases.length;
      setCurrentIndex(nextIndex);

      // Increment items practiced on transition
      if (current.phase === CyclePhase.TRANSITION) {
        setItemsPracticed((p) => p + 1);
        // Rotate threads
        setActiveThread((t) => (t % 3) + 1);
      }
    }, current.duration);

    return () => clearTimeout(timer);
  }, [currentIndex, current, isPlaying]);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleStart = useCallback(() => {
    setIsPlaying(true);
  }, []);

  return (
    <div className="demo-app">
      {/* Main Player */}
      <LearningPlayer
        item={null}
        phase={current.phase}
        activeThread={activeThread}
        sessionProgress={sessionProgress}
        isPlaying={isPlaying && current.phase !== CyclePhase.PAUSE}
        itemsPracticed={itemsPracticed}
        totalItems={10}
        phrase={current.phrase.known ? current.phrase : undefined}
        showTarget={current.showTarget}
        onStop={handleStop}
      />

      {/* Play/Pause overlay when stopped */}
      <AnimatePresence>
        {!isPlaying && (
          <motion.div
            className="demo-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.button
              className="demo-play-button"
              onClick={handleStart}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Resume Demo</span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Demo Info */}
      <div className="demo-info">
        <h1>SSi Learning Player</h1>
        <p>"Liquid Learning" Design System Demo</p>
      </div>

      <style>{`
        .demo-app {
          position: relative;
          min-height: 100vh;
        }

        .demo-overlay {
          position: fixed;
          inset: 0;
          background: rgba(10, 14, 20, 0.9);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }

        .demo-play-button {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          padding: 2rem 3rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 1.5rem;
          color: var(--ssi-glow-primary, #00d4aa);
          font-family: var(--ssi-font-body);
          font-size: 1.25rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .demo-play-button:hover {
          background: rgba(0, 212, 170, 0.1);
          border-color: rgba(0, 212, 170, 0.3);
        }

        .demo-info {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          text-align: right;
          z-index: 50;
          opacity: 0.6;
        }

        .demo-info h1 {
          font-family: var(--ssi-font-display);
          font-size: 1rem;
          font-weight: 400;
          color: var(--ssi-white-70);
          margin: 0;
        }

        .demo-info p {
          font-family: var(--ssi-font-body);
          font-size: 0.75rem;
          color: var(--ssi-white-50);
          margin: 0.25rem 0 0 0;
        }
      `}</style>
    </div>
  );
}

export default App;
