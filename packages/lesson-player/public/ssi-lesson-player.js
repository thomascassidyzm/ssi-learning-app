/**
 * <ssi-lesson-player> — drop-in marketing-demo custom element.
 *
 * Usage:
 *   <script src="https://cdn.saysomethingin.com/lesson-player.js"></script>
 *   <ssi-lesson-player course="spa_for_eng" duration="30"></ssi-lesson-player>
 *
 * Attributes:
 *   course          Course code — fetches matching manifest. Required.
 *   duration        Playback length in minutes. Default 30. Player stops
 *                   when total elapsed exceeds this (or cycles exhausted).
 *   autoplay        "true"|"false". Default false. Starts playing on load.
 *   manifest-src    Override base URL for manifests. Default relative to script.
 *   audio-src       Override base URL for audio proxy. Default saysomethingin.app.
 *   show-hints      "true"|"false". Default true. Toggle methodology overlay captions.
 *   hint-intensity  "minimal"|"standard"|"verbose". Default "standard".
 *
 * Contract:
 *   - Shadow DOM (host-page CSS never leaks in, our CSS never leaks out)
 *   - Self-contained: no external CSS, no framework dependency
 *   - Size: fluid width, fixed aspect — max-width 440px, height auto (≈900px tall at 440px)
 *   - Demo-mode only: no mic permission, no login
 *
 * Cycle types (match the real SSi app's round structure):
 *   INTRO (and component_intro): narration teaches the new LEGO.
 *     Plays presentation_audio ("The French for 'I want' is 'je veux'"),
 *     shows known text during, shows target text at end. No pause phase.
 *
 *   DEBUT / BUILD / REVIEW / CONSOLIDATE / component_practice: 4-phase cycle.
 *     1. PROMPT  — play known audio + show known text
 *     2. PAUSE   — mic-button ring activates ("your turn"), ~2× target duration
 *     3. VOICE_1 — play target audio (voice A), no text
 *     4. VOICE_2 — play target audio (voice B), show target text
 */

const DEFAULT_MANIFEST_BASE = new URL('./manifests/', import.meta.url).href;
const DEFAULT_AUDIO_BASE = 'https://saysomethingin.app/api/audio/';

// ---------------------------------------------------------------------------
// Methodology copy — user-approved tone, voice-of-Aran
// ---------------------------------------------------------------------------

const PHASE_CAPTIONS = {
  'intro-teach': 'meet the new piece',
  'intro-flash': 'that’s what it looks like',
  prompt:  'listen',
  pause:   'your turn — speak, don’t freeze',
  voice1:  'here’s how it sounds',
  voice2:  'now you’ve got it',
};

const PHILOSOPHY_QUOTES = [
  'Struggle is the learning. The gap between what you know and what you produce.',
  'The edge of your ability is where everything happens.',
];

// Milestone callbacks — return copy to display, or null to skip.
// Triggered after a specific cycle completes. `ctx` has { cycleIndex, cycle, total, targetName }.
function milestoneFor(ctx) {
  const { cycleIndex, cycle, total, targetName } = ctx;
  const completedCount = cycleIndex + 1;

  // After the first LEGO (first cycle)
  if (completedCount === 1) return 'You just learned your first piece.';

  // After the first BUILD phrase (first time we see type === 'build')
  if (cycle?.type === 'build' && cycle._firstBuild)
    return `You just combined two pieces. This is how ${targetName} works.`;

  if (completedCount === 5)
    return 'Five pieces in. Already more than most people learn in a week.';

  // Mid-demo marker at ~70% through
  const midMarker = Math.round(total * 0.7);
  if (completedCount === midMarker)
    return `Every ${targetName} sentence is built from small pieces you already know. That’s the whole trick.`;

  return null;
}

// ---------------------------------------------------------------------------
// Inline SVG assets
// ---------------------------------------------------------------------------

const ICONS = {
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2"/><path d="M12 19v3"/><path d="M8 22h8"/></svg>`,
  stopwatch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="8"/><path d="M12 10v4l2.5 2.5"/><path d="M9 2h6"/><path d="M12 2v4"/></svg>`,
  replay: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="0.5"/><rect x="14" y="5" width="4" height="14" rx="0.5"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>`,
  forward: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><polygon points="13 5 22 12 13 19 13 5" fill="currentColor"/><polygon points="3 5 12 12 3 19 3 5" fill="currentColor"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4z"/></svg>`,
  stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20V8"/><path d="M12 20V4"/><path d="M18 20v-8"/></svg>`,
  account: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  speedLimit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0-9 9"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
};

// Subtle karate-landscape silhouette strip — keeps native vibe, softened atmospherics.
const MARTIAL_SVG = `
<svg viewBox="0 0 800 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#d9d6cf"/>
      <stop offset="100%" stop-color="#b4b0a7"/>
    </linearGradient>
    <filter id="softBlur" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="0.4"/>
    </filter>
  </defs>
  <rect width="800" height="200" fill="url(#skyGrad)"/>
  <path d="M0 140 L90 90 L170 115 L260 75 L360 108 L440 78 L530 102 L615 72 L710 100 L800 82 L800 200 L0 200 Z" fill="#a6a298" opacity="0.9" filter="url(#softBlur)"/>
  <path d="M0 158 L80 122 L160 140 L250 108 L340 128 L420 112 L510 132 L600 104 L700 128 L800 114 L800 200 L0 200 Z" fill="#827e74" opacity="0.85"/>
  <g fill="#5f5b52">
    <g transform="translate(30,65)"><path d="M12 0 a4 4 0 1 1 0 8 a4 4 0 1 1 0-8 M10 9 L14 9 L14 30 L20 45 L16 46 L12 32 L8 46 L4 45 L10 30 Z"/></g>
    <g transform="translate(150,70)"><path d="M12 0 a4 4 0 1 1 0 8 a4 4 0 1 1 0-8 M10 9 L14 9 L14 28 L24 32 L23 36 L14 33 L14 42 L19 55 L15 56 L12 44 L9 56 L5 55 L10 42 Z"/></g>
    <g transform="translate(290,60)"><path d="M12 0 a4 4 0 1 1 0 8 a4 4 0 1 1 0-8 M10 9 L14 9 L14 27 L28 15 L30 18 L16 30 L16 45 L25 60 L21 62 L13 50 L6 62 L2 60 L10 45 Z"/></g>
    <g transform="translate(430,67)"><path d="M12 0 a4 4 0 1 1 0 8 a4 4 0 1 1 0-8 M10 9 L14 9 L14 30 L2 36 L0 33 L12 27 L12 42 L17 55 L13 57 L10 45 L7 57 L3 55 L9 42 Z"/></g>
    <g transform="translate(570,63)"><path d="M12 0 a4 4 0 1 1 0 8 a4 4 0 1 1 0-8 M10 9 L14 9 L14 28 L28 22 L30 25 L16 31 L16 44 L22 58 L18 60 L13 48 L7 60 L3 58 L9 44 Z"/></g>
    <g transform="translate(720,67)"><path d="M12 0 a4 4 0 1 1 0 8 a4 4 0 1 1 0-8 M10 9 L14 9 L14 27 L4 18 L2 21 L12 30 L12 44 L18 58 L14 60 L11 48 L7 58 L3 56 L9 44 Z"/></g>
  </g>
  <g fill="#141414">
    <g transform="translate(390,100)"><path d="M10 0 a4 4 0 1 1 0 8 a4 4 0 1 1 0-8 M8 9 L12 9 L12 26 L22 10 L26 13 L14 30 L14 42 L20 54 L16 56 L11 45 L6 56 L2 54 L8 42 Z"/></g>
    <g transform="translate(540,118)" opacity="0.55"><path d="M710 40 l35 -20 l30 18 l40 -10 l20 12 l45 -16 l30 14 L900 180 L0 180 Z"/></g>
  </g>
  <path d="M0 172 L70 150 L150 164 L230 142 L320 158 L410 136 L490 155 L580 138 L670 158 L750 144 L800 152 L800 200 L0 200 Z" fill="#141414"/>
</svg>`;

// Very faint grain — adds paper texture. Data URI to avoid extra fetches.
const GRAIN_DATA_URI = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>";

// ---------------------------------------------------------------------------
// Styles — meticulous editorial minimalism within the native frame
// ---------------------------------------------------------------------------

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..500&family=Inter+Tight:wght@400;500;600;700&display=swap');

:host {
  /* palette — refined native */
  --ssi-red: #e53935;
  --ssi-red-soft: rgba(229, 57, 53, 0.88);
  --ssi-paper: #e7e6e3;
  --ssi-paper-warm: #ece9e3;
  --ssi-card: #f2f1ec;
  --ssi-card-deep: #ece9e3;
  --ssi-ink: #141414;
  --ssi-ink-soft: rgba(20, 20, 20, 0.78);
  --ssi-muted: #7a766d;
  --ssi-muted-soft: #a5a19a;
  --ssi-hair: rgba(20, 20, 20, 0.09);
  --ssi-gold: #d4a82e;
  --ssi-black: #131312;

  /* typography */
  --ssi-serif: 'Fraunces', ui-serif, Georgia, 'Times New Roman', serif;
  --ssi-sans: 'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  /* motion */
  --ssi-ease: cubic-bezier(0.32, 0.72, 0.35, 1);
  --ssi-ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  display: inline-block;
  width: 100%;
  max-width: 440px;
  aspect-ratio: 440 / 900;
  font-family: var(--ssi-sans);
  font-feature-settings: 'ss01', 'cv11';
  color: var(--ssi-ink);
  contain: layout style;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* { box-sizing: border-box; }

.frame {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--ssi-paper);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 8px 32px rgba(0, 0, 0, 0.08);
}

/* Grain overlay — paper texture */
.frame::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("${GRAIN_DATA_URI}");
  background-size: 160px 160px;
  opacity: 0.5;
  mix-blend-mode: multiply;
  pointer-events: none;
  z-index: 1;
}

.frame > * { position: relative; z-index: 2; }

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 22px 22px 8px;
}
.logo {
  font-family: var(--ssi-sans);
  font-weight: 700;
  font-size: 21px;
  letter-spacing: -0.025em;
  line-height: 1;
  display: inline-flex;
  align-items: baseline;
}
.logo .red { color: var(--ssi-red); }
.logo .bubble {
  display: inline-block;
  width: 11px;
  height: 11px;
  margin-left: 2px;
  position: relative;
  top: -1px;
}
.logo .bubble::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--ssi-red);
  border-radius: 2px 2px 2px 0;
  transform: rotate(0deg);
}
.lang-pill {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  background: #fff;
  padding: 8px 14px 8px 10px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03);
  color: var(--ssi-ink);
  line-height: 1;
}
.lang-pill .flag { font-size: 16px; line-height: 1; }

/* ------------------------------------------------------------------ */
/* Phrase card — hero typography                                       */
/* ------------------------------------------------------------------ */
.phrase-card {
  position: relative;
  margin: 14px 18px 8px;
  padding: 28px 22px;
  min-height: 104px;
  background: var(--ssi-card);
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  box-shadow: 0 1px 1px rgba(0,0,0,0.02);
  overflow: hidden;
}
.phrase-text {
  font-family: var(--ssi-serif);
  font-variation-settings: 'opsz' 72, 'SOFT' 40;
  font-weight: 420;
  font-size: 40px;
  line-height: 1.05;
  letter-spacing: -0.025em;
  color: var(--ssi-ink);
  transition: opacity 0.4s var(--ssi-ease-out),
              transform 0.4s var(--ssi-ease-out);
  will-change: opacity, transform;
}
.phrase-text.enter {
  opacity: 0;
  transform: translateY(3px);
}
.phrase-text.idle {
  opacity: 0;
  transform: translateY(0);
}
/* Milestone state: phrase card transforms into a quiet italic quote */
.phrase-card.milestone .phrase-text {
  font-size: 17px;
  font-weight: 400;
  font-style: italic;
  font-variation-settings: 'opsz' 14;
  letter-spacing: 0;
  color: var(--ssi-ink-soft);
  line-height: 1.45;
  padding: 0 8px;
}
.phrase-card.milestone::before {
  content: '·';
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--ssi-serif);
  font-size: 18px;
  color: var(--ssi-muted-soft);
  line-height: 1;
}

/* Phase bead — four dots showing progress through the 4-phase cycle */
.phase-bead {
  position: absolute;
  left: 50%;
  bottom: 11px;
  transform: translateX(-50%);
  display: flex;
  gap: 5px;
  opacity: 0.55;
  transition: opacity 0.3s var(--ssi-ease);
}
.phrase-card.milestone .phase-bead { opacity: 0; }
.phase-bead .bead {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ssi-muted-soft);
  transition: background 0.25s var(--ssi-ease), transform 0.25s var(--ssi-ease);
}
.phase-bead .bead.active {
  background: var(--ssi-red);
  transform: scale(1.35);
}

/* ------------------------------------------------------------------ */
/* Mic card — caption strip + mic button + timer                       */
/* ------------------------------------------------------------------ */
.mic-card {
  position: relative;
  margin: 0 18px;
  padding: 34px 22px 28px;
  background: var(--ssi-card);
  border-radius: 20px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 272px;
  box-shadow: 0 1px 1px rgba(0,0,0,0.02);
  overflow: hidden;
}

/* Methodology caption — whispered stage direction at the top edge */
.caption-strip {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--ssi-serif);
  font-weight: 400;
  font-style: italic;
  font-variation-settings: 'opsz' 14;
  font-size: 13px;
  letter-spacing: 0.01em;
  color: var(--ssi-muted);
  opacity: 0;
  transition: opacity 0.5s var(--ssi-ease-out);
  white-space: nowrap;
  pointer-events: none;
  text-align: center;
  max-width: 90%;
}
.caption-strip.show { opacity: 0.68; }
.caption-strip::before,
.caption-strip::after {
  content: '';
  display: inline-block;
  width: 14px;
  height: 1px;
  background: var(--ssi-muted-soft);
  vertical-align: middle;
  margin: 0 9px;
  opacity: 0.6;
}

/* Philosophy card — appears briefly, feels earned */
.caption-strip.philosophy {
  font-size: 12.5px;
  max-width: 78%;
  white-space: normal;
  line-height: 1.5;
}

.mic-button {
  position: relative;
  width: 118px;
  height: 118px;
  border-radius: 50%;
  background: #fcfcfb;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 1px 0 rgba(255,255,255,0.6) inset,
    0 2px 8px rgba(0,0,0,0.08),
    0 0 0 1px rgba(0,0,0,0.03);
  transition: transform 0.35s var(--ssi-ease-out);
  animation: micBreathe 4s ease-in-out infinite;
}
@keyframes micBreathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.012); }
}
.mic-button.active {
  animation: none;
  box-shadow:
    0 0 0 3px var(--ssi-red),
    0 2px 12px rgba(229, 57, 53, 0.22),
    0 0 0 1px rgba(0,0,0,0.03);
}
.mic-button.active::after {
  content: '';
  position: absolute;
  inset: -14px;
  border: 1.5px solid var(--ssi-red);
  border-radius: 50%;
  opacity: 0.22;
  animation: micPulse 1.8s var(--ssi-ease-out) infinite;
}
@keyframes micPulse {
  0%   { transform: scale(0.92); opacity: 0.35; }
  80%  { transform: scale(1.25); opacity: 0; }
  100% { transform: scale(1.25); opacity: 0; }
}
.mic-icon {
  width: 42px;
  height: 42px;
  color: var(--ssi-red);
}

.timer {
  position: absolute;
  right: 18px;
  bottom: 18px;
  background: var(--ssi-red);
  color: #fff;
  padding: 8px 13px;
  border-radius: 11px;
  font-weight: 700;
  font-size: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(229,57,53,0.18);
}
.timer-icon { width: 17px; height: 17px; }

/* ------------------------------------------------------------------ */
/* Belt section + silhouettes                                          */
/* ------------------------------------------------------------------ */
.belt-wrap {
  position: relative;
  margin-top: 14px;
}
.belt-label {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: -0.015em;
  padding: 0 22px 6px;
  color: var(--ssi-ink);
}
.belt-check {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--ssi-red);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ssi-red);
  font-size: 10px;
  font-weight: 900;
}
.belt-check::after { content: '✓'; }
.belt-label .pct {
  color: var(--ssi-ink);
  font-variant-numeric: tabular-nums;
}

.silhouettes {
  position: relative;
  width: 100%;
  height: 92px;
  overflow: hidden;
}
.silhouettes svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* Walker figure — a stylised red figure that slides along */
.walker {
  position: absolute;
  bottom: 22px;
  left: 0;
  width: 22px;
  height: 44px;
  transform: translateX(-50%);
  transition: left 0.6s var(--ssi-ease-out);
  color: var(--ssi-red);
  z-index: 3;
}

.progress-track {
  position: absolute;
  bottom: 14px;
  left: 0;
  right: 0;
  height: 8px;
  background: #b0ada4;
  overflow: hidden;
}
.progress-fill {
  position: absolute;
  inset: 0;
  width: 0%;
  background: #fafaf6;
  transition: width 0.6s var(--ssi-ease-out);
}
.belt-indicator {
  position: absolute;
  top: -30px;
  left: 0;
  transform: translateX(-50%);
  transition: left 0.6s var(--ssi-ease-out);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}
.belt-indicator .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ssi-ink);
}
.belt-indicator .stem {
  width: 1.5px;
  height: 30px;
  background: var(--ssi-ink);
}

/* ------------------------------------------------------------------ */
/* Bottom controls (black)                                             */
/* ------------------------------------------------------------------ */
.bottom-area {
  position: relative;
  background: var(--ssi-black);
  padding: 24px 16px 12px;
  display: flex;
  justify-content: center;
  align-items: center;
}
.speed-btn {
  position: absolute;
  right: 18px;
  top: -52px;
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: var(--ssi-red);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  box-shadow: 0 3px 8px rgba(229,57,53,0.35);
  transition: transform 0.2s var(--ssi-ease);
}
.speed-btn:hover { transform: translateY(-1px); }
.speed-btn svg { width: 24px; height: 24px; }

.transport {
  background: #6b6b69;
  border-radius: 100px;
  padding: 6px 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.transport button {
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.12s var(--ssi-ease);
}
.transport button:active { transform: scale(0.94); }
.transport .side-btn {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: #fff;
  color: var(--ssi-muted);
}
.transport .side-btn svg { width: 20px; height: 20px; }
.transport .main-btn {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: var(--ssi-red);
  color: #fff;
  box-shadow: 0 2px 6px rgba(229,57,53,0.3);
}
.transport .main-btn svg { width: 24px; height: 24px; }

/* ------------------------------------------------------------------ */
/* Bottom nav                                                          */
/* ------------------------------------------------------------------ */
.nav {
  background: var(--ssi-black);
  display: flex;
  padding: 10px 0 16px;
  justify-content: space-around;
  border-top: 1px solid rgba(255,255,255,0.05);
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: #8b8986;
  font-weight: 500;
  letter-spacing: -0.01em;
  cursor: default;
}
.nav-item.active {
  color: var(--ssi-gold);
}
.nav-item svg { width: 22px; height: 22px; }

/* ------------------------------------------------------------------ */
/* End CTA — editorial                                                 */
/* ------------------------------------------------------------------ */
.end-cta {
  position: absolute;
  inset: 0;
  background: var(--ssi-paper-warm);
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px 36px;
  animation: ctaFade 0.55s var(--ssi-ease-out) both;
}
@keyframes ctaFade {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.end-cta::before {
  /* same grain layer on the CTA page */
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("${GRAIN_DATA_URI}");
  background-size: 160px 160px;
  opacity: 0.45;
  mix-blend-mode: multiply;
  pointer-events: none;
}
.end-cta > * { position: relative; z-index: 1; }
.end-cta .kicker {
  font-family: var(--ssi-sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ssi-muted);
  margin: 0 0 14px;
  animation: ctaStagger 0.6s 0.05s var(--ssi-ease-out) both;
}
.end-cta h2 {
  font-family: var(--ssi-serif);
  font-variation-settings: 'opsz' 72;
  font-weight: 420;
  font-size: 34px;
  line-height: 1.1;
  letter-spacing: -0.025em;
  color: var(--ssi-ink);
  margin: 0 0 18px;
  animation: ctaStagger 0.6s 0.12s var(--ssi-ease-out) both;
}
.end-cta h2 em {
  font-style: italic;
  font-variation-settings: 'opsz' 72;
  color: var(--ssi-red);
  font-weight: 420;
}
.end-cta p {
  font-family: var(--ssi-sans);
  font-size: 15px;
  line-height: 1.55;
  color: var(--ssi-muted);
  margin: 0 0 28px;
  animation: ctaStagger 0.6s 0.2s var(--ssi-ease-out) both;
}
@keyframes ctaStagger {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.end-cta .actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 4px;
  animation: ctaStagger 0.6s 0.28s var(--ssi-ease-out) both;
}
.end-cta .cta-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--ssi-sans);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ssi-red);
  text-decoration: none;
  padding: 2px 0;
  border-bottom: 1.5px solid var(--ssi-red);
  align-self: flex-start;
  transition: gap 0.25s var(--ssi-ease);
}
.end-cta .cta-link svg { width: 16px; height: 16px; margin-left: 2px; }
.end-cta .cta-link:hover { gap: 10px; }
.end-cta .replay-btn {
  background: transparent;
  color: var(--ssi-muted);
  border: none;
  font-family: var(--ssi-sans);
  font-size: 13px;
  letter-spacing: 0.02em;
  padding: 0;
  cursor: pointer;
  align-self: flex-start;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  text-decoration-color: rgba(122,118,109,0.4);
  transition: color 0.2s var(--ssi-ease);
}
.end-cta .replay-btn:hover { color: var(--ssi-ink); }
.end-cta .hairline {
  height: 1px;
  background: var(--ssi-hair);
  margin: 28px 0 24px;
  animation: ctaStagger 0.6s 0.24s var(--ssi-ease-out) both;
}
.end-cta .stat {
  font-family: var(--ssi-serif);
  font-style: italic;
  font-size: 13px;
  color: var(--ssi-muted);
  margin: 24px 0 0;
  animation: ctaStagger 0.6s 0.36s var(--ssi-ease-out) both;
}

/* ------------------------------------------------------------------ */
/* Loading / error                                                     */
/* ------------------------------------------------------------------ */
.loading, .error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ssi-muted);
  padding: 40px;
  text-align: center;
  font-size: 14px;
  font-family: var(--ssi-sans);
}
.error { color: var(--ssi-red); }
`;

// Dynamic pause duration = 2× target audio length (approx)
const PAUSE_MULTIPLIER = 2.0;
const GAP_BETWEEN_CYCLES_MS = 350;
const INTRO_TARGET_FLASH_MS = 1400;    // how long target text shows at end of an intro
const MILESTONE_DURATION_MS = 2600;
const PHILOSOPHY_AT_CYCLE_RATIO = 0.45;  // show one philosophy line ~45% through
const DEFAULT_DURATION_MIN = 30;       // default clamp in minutes

const INTRO_TYPES = new Set(['intro', 'component_intro']);

class SsiLessonPlayer extends HTMLElement {
  static get observedAttributes() {
    return ['course', 'duration', 'autoplay', 'manifest-src', 'audio-src', 'show-hints', 'hint-intensity'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._manifest = null;
    this._cycleIndex = 0;
    this._phase = 'idle';
    this._playing = false;
    this._audio = null;
    this._timers = [];
    this._elapsedSec = 0;
    this._elapsedTimer = null;
    this._milestoneText = null;
    this._milestoneTimer = null;
    this._philosophyShown = false;
    this._seenBuild = false;
    this._phaseCaption = null;
  }

  connectedCallback() { this._render(); this._load(); }
  attributeChangedCallback() { if (this._manifest) this._load(); }
  disconnectedCallback() { this._cleanup(); }

  _cleanup() {
    if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio = null; }
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
    if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
    if (this._milestoneTimer) { clearTimeout(this._milestoneTimer); this._milestoneTimer = null; }
  }

  async _load() {
    this._cleanup();
    const course = this.getAttribute('course');
    if (!course) {
      this._showError('No course attribute specified.');
      return;
    }
    const base = this.getAttribute('manifest-src') || DEFAULT_MANIFEST_BASE;
    const url = new URL(`${course}.json`, base.endsWith('/') ? base : base + '/').href;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`manifest fetch ${res.status}`);
      this._manifest = await res.json();
      // Annotate the first BUILD cycle so we can trigger a milestone on it
      let seen = false;
      for (const c of this._manifest.cycles) {
        if (c.type === 'build' && !seen) { c._firstBuild = true; seen = true; }
      }
    } catch (err) {
      this._showError(`Failed to load ${course}: ${err.message}`);
      return;
    }
    this._cycleIndex = 0;
    this._phase = 'idle';
    this._elapsedSec = 0;
    this._milestoneText = null;
    this._philosophyShown = false;
    this._seenBuild = false;
    this._phaseCaption = null;
    this._render();
    if (this.getAttribute('autoplay') === 'true') this._start();
  }

  _audioUrl(audioId) {
    if (!audioId) return null;
    const base = this.getAttribute('audio-src') || DEFAULT_AUDIO_BASE;
    return `${base.endsWith('/') ? base : base + '/'}${audioId}`;
  }

  async _playAudio(url) {
    return new Promise((resolve, reject) => {
      if (!this._audio) this._audio = new Audio();
      this._audio.src = url;
      this._audio.onended = () => resolve();
      this._audio.onerror = () => reject(new Error('audio error'));
      this._audio.play().catch(reject);
    });
  }

  _estimateDuration() {
    const cycle = this._manifest?.cycles?.[this._cycleIndex];
    const targetLen = cycle?.target_text?.length || 15;
    return Math.max(1200, Math.min(4000, targetLen * 120));
  }

  _wait(ms) {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(), ms);
      this._timers.push(t);
    });
  }

  _start() {
    if (this._playing) return;
    this._playing = true;
    this._render();
    if (!this._elapsedTimer) {
      this._elapsedTimer = setInterval(() => {
        this._elapsedSec++;
        this._updateTimer();
      }, 1000);
    }
    this._runCycle();
  }

  _pause() {
    this._playing = false;
    this._cleanup();
    this._render();
  }

  _hintsEnabled() {
    const v = this.getAttribute('show-hints');
    return v !== 'false'; // default true
  }

  _setPhaseCaption() {
    if (!this._hintsEnabled()) { this._phaseCaption = null; return; }
    this._phaseCaption = PHASE_CAPTIONS[this._phase] || null;
  }

  _maybeShowPhilosophy() {
    if (this._philosophyShown) return;
    if (!this._hintsEnabled()) return;
    const total = this._manifest.cycles.length;
    const threshold = Math.floor(total * PHILOSOPHY_AT_CYCLE_RATIO);
    if (this._cycleIndex >= threshold) {
      const quote = PHILOSOPHY_QUOTES[Math.floor(Math.random() * PHILOSOPHY_QUOTES.length)];
      this._philosophyText = quote;
      this._philosophyShown = true;
      this._philosophyVisible = true;
      this._render();
      const t = setTimeout(() => {
        this._philosophyVisible = false;
        this._render();
      }, 3500);
      this._timers.push(t);
    }
  }

  _maybeShowMilestone(cycle) {
    if (!this._hintsEnabled()) return;
    if (cycle.type === 'build' && !this._seenBuild) {
      this._seenBuild = true;
      cycle._firstBuild = true;
    }
    const text = milestoneFor({
      cycleIndex: this._cycleIndex,
      cycle,
      total: this._manifest.cycles.length,
      targetName: this._manifest.target_name || 'this language',
    });
    if (!text) return;
    this._milestoneText = text;
    this._render();
    if (this._milestoneTimer) clearTimeout(this._milestoneTimer);
    this._milestoneTimer = setTimeout(() => {
      this._milestoneText = null;
      this._render();
    }, MILESTONE_DURATION_MS);
  }

  _durationLimitSec() {
    const raw = this.getAttribute('duration');
    const mins = raw == null ? DEFAULT_DURATION_MIN : parseFloat(raw);
    if (!isFinite(mins) || mins <= 0) return DEFAULT_DURATION_MIN * 60;
    return mins * 60;
  }

  _shouldEndByDuration() {
    return this._elapsedSec >= this._durationLimitSec();
  }

  async _runCycle() {
    if (!this._playing || !this._manifest) return;

    // Stop when either cycles exhausted OR duration clamp reached
    if (this._cycleIndex >= this._manifest.cycles.length || this._shouldEndByDuration()) {
      this._phase = 'ended';
      this._playing = false;
      this._render();
      return;
    }

    const cycle = this._manifest.cycles[this._cycleIndex];

    // Maybe show philosophy quote in caption slot (once, mid-demo)
    this._maybeShowPhilosophy();

    if (INTRO_TYPES.has(cycle.type)) {
      // INTRO: play the narration, show known text during, flash target at end.
      // No pause phase — this is a teaching moment, not a practice moment.
      this._phase = 'intro-teach';
      this._setPhaseCaption();
      this._render();
      if (cycle.presentation_audio_id) {
        try { await this._playAudio(this._audioUrl(cycle.presentation_audio_id)); } catch { /* continue */ }
      }
      if (!this._playing) return;

      // Brief flash of target text so the eye sees the correct form
      this._phase = 'intro-flash';
      this._setPhaseCaption();
      this._render();
      await this._wait(INTRO_TARGET_FLASH_MS);
      if (!this._playing) return;
    } else {
      // STANDARD 4-phase cycle: prompt → pause → voice1 → voice2

      // 1. PROMPT
      this._phase = 'prompt';
      this._setPhaseCaption();
      this._render();
      if (cycle.known_audio_id) {
        try { await this._playAudio(this._audioUrl(cycle.known_audio_id)); } catch { /* continue */ }
      }
      if (!this._playing) return;

      // 2. PAUSE
      this._phase = 'pause';
      this._setPhaseCaption();
      this._render();
      await this._wait(this._estimateDuration() * PAUSE_MULTIPLIER);
      if (!this._playing) return;

      // 3. VOICE_1
      this._phase = 'voice1';
      this._setPhaseCaption();
      this._render();
      if (cycle.target1_audio_id) {
        try { await this._playAudio(this._audioUrl(cycle.target1_audio_id)); } catch { /* continue */ }
      }
      if (!this._playing) return;

      await this._wait(200);

      // 4. VOICE_2
      this._phase = 'voice2';
      this._setPhaseCaption();
      this._render();
      if (cycle.target2_audio_id) {
        try { await this._playAudio(this._audioUrl(cycle.target2_audio_id)); } catch { /* continue */ }
      }
      if (!this._playing) return;
    }

    // Gap + milestone check
    this._phase = 'gap';
    this._phaseCaption = null;
    this._maybeShowMilestone(cycle);
    this._render();
    await this._wait(this._milestoneText ? MILESTONE_DURATION_MS : GAP_BETWEEN_CYCLES_MS);
    this._cycleIndex++;
    this._runCycle();
  }

  _skipBackward() {
    if (!this._manifest || this._cycleIndex === 0) return;
    this._cycleIndex = Math.max(0, this._cycleIndex - 1);
    if (this._audio) { this._audio.pause(); this._audio.src = ''; }
    if (this._playing) this._runCycle();
    else this._render();
  }

  _skipForward() {
    if (!this._manifest) return;
    if (this._cycleIndex >= this._manifest.cycles.length - 1) return;
    this._cycleIndex++;
    if (this._audio) { this._audio.pause(); this._audio.src = ''; }
    if (this._playing) this._runCycle();
    else this._render();
  }

  _replay() {
    this._cleanup();
    this._cycleIndex = 0;
    this._elapsedSec = 0;
    this._milestoneText = null;
    this._philosophyShown = false;
    this._philosophyVisible = false;
    this._seenBuild = false;
    this._phaseCaption = null;
    this._playing = true;
    this._phase = 'idle';
    this._render();
    if (!this._elapsedTimer) {
      this._elapsedTimer = setInterval(() => {
        this._elapsedSec++;
        this._updateTimer();
      }, 1000);
    }
    this._runCycle();
  }

  _showError(msg) {
    this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="frame"><div class="error">${msg}</div></div>`;
  }

  _formatTime(s) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  _updateTimer() {
    const el = this.shadowRoot?.querySelector('.timer-text');
    if (el) el.textContent = this._formatTime(this._elapsedSec);
  }

  _phaseBeadIndex() {
    // Standard 4-phase cycle: 0..3 for prompt/pause/voice1/voice2
    // INTRO uses a 2-phase map onto beads 0 and 3 (first + last)
    const map = {
      prompt: 0, pause: 1, voice1: 2, voice2: 3,
      'intro-teach': 0, 'intro-flash': 3,
    };
    return map[this._phase] ?? -1;
  }

  _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  _render() {
    if (!this._manifest) {
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="frame"><div class="loading">Loading lesson…</div></div>`;
      return;
    }

    const m = this._manifest;
    const cycle = m.cycles[Math.min(this._cycleIndex, m.cycles.length - 1)];
    const isIntroCycle = cycle && INTRO_TYPES.has(cycle.type);
    // Known text shows: during the narration-teach, during prompt/pause/voice1
    const showKnown = this._phase === 'intro-teach'
                   || this._phase === 'prompt'
                   || this._phase === 'pause'
                   || this._phase === 'voice1';
    // Target text shows: during the intro flash, and during voice2 of a standard cycle
    const showTarget = this._phase === 'intro-flash' || this._phase === 'voice2';
    // Mic activates during pause (your turn). Intros don't prompt speech, so mic stays calm.
    const micActive = this._phase === 'pause';
    const belt = cycle?.belt_progress || 0;
    const beltPct = Math.round(belt * 100);
    const ended = this._phase === 'ended';
    const inMilestone = !!this._milestoneText;

    const displayText = inMilestone ? this._milestoneText
                      : showKnown ? (cycle?.known_text || '')
                      : showTarget ? (cycle?.target_text || '')
                      : '';

    const textClass = (!displayText && !inMilestone)
      ? 'phrase-text idle'
      : 'phrase-text';

    // Caption strip (phase hint OR philosophy quote)
    const philosophyNow = this._hintsEnabled() && this._philosophyVisible && this._philosophyText;
    const captionText = philosophyNow ? this._philosophyText
                      : (this._hintsEnabled() && this._phaseCaption) ? this._phaseCaption
                      : '';
    const captionShow = !!captionText && !inMilestone && !ended;
    const captionClass = `caption-strip ${captionShow ? 'show' : ''} ${philosophyNow ? 'philosophy' : ''}`;

    const isPlayingMainBtn = this._playing;
    const phaseBead = this._phaseBeadIndex();

    const elapsedMinutes = Math.max(1, Math.round(this._elapsedSec / 60));

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="frame">
        <div class="header">
          <div class="logo"><span class="red">Say</span><span>Something</span><span class="red">in</span><span class="bubble"></span></div>
          <div class="lang-pill"><span class="flag">${m.flag_emoji || '🏳️'}</span> ${this._escapeHtml(m.target_name || '')}</div>
        </div>

        <div class="phrase-card ${inMilestone ? 'milestone' : ''}">
          <div class="${textClass}">${this._escapeHtml(displayText) || '\u00A0'}</div>
          ${!ended && !inMilestone ? `
            <div class="phase-bead">
              ${[0,1,2,3].map(i => `<div class="bead ${i === phaseBead ? 'active' : ''}"></div>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="mic-card">
          <div class="${captionClass}">${this._escapeHtml(captionText)}</div>
          <div class="mic-button ${micActive ? 'active' : ''}">
            <div class="mic-icon">${ICONS.mic}</div>
          </div>
          <div class="timer">
            <span class="timer-icon">${ICONS.stopwatch}</span>
            <span class="timer-text">${this._formatTime(this._elapsedSec)}</span>
          </div>
        </div>

        <div class="belt-wrap">
          <div class="belt-label">
            <span class="belt-check"></span>
            White Belt — <span class="pct">${beltPct}%</span>
          </div>
          <div class="silhouettes">
            ${MARTIAL_SVG}
            <div class="walker" style="left: ${beltPct}%">
              <svg viewBox="0 0 22 44" xmlns="http://www.w3.org/2000/svg">
                <path fill="currentColor" d="M11 0 a4 4 0 1 1 0 8 a4 4 0 1 1 0-8 M9 9 L13 9 L13 24 L21 20 L22 23 L13 27 L13 32 L18 43 L14 44 L11 34 L8 44 L4 43 L9 32 Z"/>
              </svg>
            </div>
            <div class="progress-track"><div class="progress-fill" style="width: ${beltPct}%"></div></div>
            <div class="belt-indicator" style="left: ${beltPct}%">
              <div class="dot"></div>
              <div class="stem"></div>
            </div>
          </div>
        </div>

        <div class="bottom-area">
          <button class="speed-btn" title="Playback speed">${ICONS.speedLimit}</button>
          <div class="transport">
            <button class="side-btn" data-act="back" title="Back">${ICONS.replay}</button>
            <button class="main-btn" data-act="toggle" title="${isPlayingMainBtn ? 'Pause' : 'Play'}">${isPlayingMainBtn ? ICONS.pause : ICONS.play}</button>
            <button class="side-btn" data-act="forward" title="Forward">${ICONS.forward}</button>
          </div>
        </div>

        <div class="nav">
          <div class="nav-item">${ICONS.home}<span>Home</span></div>
          <div class="nav-item active">${ICONS.bookmark}<span>Learning</span></div>
          <div class="nav-item">${ICONS.stats}<span>Stats</span></div>
          <div class="nav-item">${ICONS.account}<span>Account</span></div>
        </div>

        ${ended ? this._renderEndCta(elapsedMinutes) : ''}
      </div>
    `;

    // Wire transport
    this.shadowRoot.querySelectorAll('[data-act]').forEach(el => {
      el.addEventListener('click', (e) => {
        const act = e.currentTarget.getAttribute('data-act');
        if (act === 'toggle') { this._playing ? this._pause() : this._start(); }
        else if (act === 'back') this._skipBackward();
        else if (act === 'forward') this._skipForward();
        else if (act === 'replay') this._replay();
      });
    });
  }

  _renderEndCta(mins) {
    const target = this._escapeHtml(this._manifest.target_name || 'it');
    const piecesLearned = this._manifest.cycles.length;
    return `
      <div class="end-cta">
        <p class="kicker">· end of demo ·</p>
        <h2>You just built <em>${target}</em> from scratch in ${mins} minute${mins === 1 ? '' : 's'}.</h2>
        <p>This pattern repeats, builds, and compounds into real conversations.</p>
        <div class="hairline"></div>
        <div class="actions">
          <a class="cta-link" href="https://saysomethingin.com/" target="_top">
            Get the full course ${ICONS.chevron}
          </a>
          <button class="replay-btn" data-act="replay">Replay demo</button>
        </div>
        <p class="stat">${piecesLearned} pieces · ${mins} minute${mins === 1 ? '' : 's'} · one full sentence built from scratch.</p>
      </div>
    `;
  }
}

// Register — guard against double-definition
if (!customElements.get('ssi-lesson-player')) {
  customElements.define('ssi-lesson-player', SsiLessonPlayer);
}

export default SsiLessonPlayer;
