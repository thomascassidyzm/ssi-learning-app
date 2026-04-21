/**
 * <ssi-lesson-player> — drop-in marketing-demo custom element.
 *
 * Usage:
 *   <script src="https://cdn.saysomethingin.com/lesson-player.js"></script>
 *   <ssi-lesson-player course="spa_for_eng" autoplay="false"></ssi-lesson-player>
 *
 * Attributes:
 *   course        Course code — fetches matching manifest. Required.
 *   autoplay      "true"|"false". Default false. If true, starts playing on load.
 *   manifest-src  Override base URL for manifests. Default relative to script.
 *   audio-src     Override base URL for audio proxy. Default saysomethingin.app.
 *
 * Contract:
 *   - Shadow DOM (host-page CSS never leaks in, our CSS never leaks out)
 *   - Self-contained: no external CSS, no framework dependency
 *   - Size: fluid width, fixed aspect — max-width 440px, height auto (≈812px tall at 440px)
 *   - Demo-mode only: no mic permission, no login, fixed ~3-min script
 *
 * Cycle (4 phases per item, matches SSi native app):
 *   1. PROMPT  — play known audio + show English
 *   2. PAUSE   — mic-button ring activates ("your turn"), ~2× target duration
 *   3. VOICE_1 — play target audio (voice A)
 *   4. VOICE_2 — play target audio (voice B), show target text
 */

const DEFAULT_MANIFEST_BASE = new URL('./manifests/', import.meta.url).href;
const DEFAULT_AUDIO_BASE = 'https://saysomethingin.app/api/audio/';

// Inline SVG assets — avoid extra fetches
const ICONS = {
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>`,
  stopwatch: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="14" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10v4l2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 2h4M12 2v4"/></svg>`,
  replay: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l11-7z"/></svg>`,
  forward: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="13 5 22 12 13 19 13 5"/><polygon points="3 5 12 12 3 19 3 5"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5v18l7-5 7 5V5a2 2 0 00-2-2H7a2 2 0 00-2 2z"/></svg>`,
  stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 20V10M12 20V4M17 20v-6"/></svg>`,
  account: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 11a4 4 0 11-8 0 4 4 0 018 0zM4 21a8 8 0 0116 0"/></svg>`,
  speedLimit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 00-9 9"/></svg>`,
};

// Martial-arts silhouette strip (simple SVG placeholder — Claude Design
// can swap an asset URL later if they want the exact artwork from the native app).
const MARTIAL_SVG = `
<svg viewBox="0 0 800 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#d8d8d6"/>
      <stop offset="100%" stop-color="#b8b8b5"/>
    </linearGradient>
  </defs>
  <rect width="800" height="180" fill="url(#sky)"/>
  <!-- distant mountains -->
  <path d="M0 135 L90 90 L170 110 L260 75 L350 105 L430 80 L520 100 L610 70 L700 100 L800 80 L800 180 L0 180 Z" fill="#b3b3b0"/>
  <path d="M0 150 L80 115 L160 135 L250 105 L340 125 L420 110 L510 128 L600 100 L700 125 L800 110 L800 180 L0 180 Z" fill="#9a9a96" opacity="0.85"/>
  <!-- figures -->
  <g fill="#5a5a58" transform="translate(30,60)">
    <!-- stance 1 -->
    <path d="M12 0 a4 4 0 110 8 a4 4 0 110 -8 M10 9 L14 9 L14 30 L20 45 L16 46 L12 32 L8 46 L4 45 L10 30 Z"/>
  </g>
  <g fill="#5a5a58" transform="translate(150,65)">
    <path d="M12 0 a4 4 0 110 8 a4 4 0 110 -8 M10 9 L14 9 L14 28 L24 32 L23 36 L14 33 L14 42 L19 55 L15 56 L12 44 L9 56 L5 55 L10 42 Z"/>
  </g>
  <g fill="#5a5a58" transform="translate(290,55)">
    <path d="M12 0 a4 4 0 110 8 a4 4 0 110 -8 M10 9 L14 9 L14 27 L28 15 L30 18 L16 30 L16 45 L25 60 L21 62 L13 50 L6 62 L2 60 L10 45 Z"/>
  </g>
  <g fill="#5a5a58" transform="translate(430,62)">
    <path d="M12 0 a4 4 0 110 8 a4 4 0 110 -8 M10 9 L14 9 L14 30 L2 36 L0 33 L12 27 L12 42 L17 55 L13 57 L10 45 L7 57 L3 55 L9 42 Z"/>
  </g>
  <g fill="#5a5a58" transform="translate(570,58)">
    <path d="M12 0 a4 4 0 110 8 a4 4 0 110 -8 M10 9 L14 9 L14 28 L28 22 L30 25 L16 31 L16 44 L22 58 L18 60 L13 48 L7 60 L3 58 L9 44 Z"/>
  </g>
  <g fill="#5a5a58" transform="translate(720,62)">
    <path d="M12 0 a4 4 0 110 8 a4 4 0 110 -8 M10 9 L14 9 L14 27 L4 18 L2 21 L12 30 L12 44 L18 58 L14 60 L11 48 L7 58 L3 56 L9 44 Z"/>
  </g>
  <!-- centered samurai on the hill -->
  <g fill="#1c1c1c" transform="translate(395,95)">
    <path d="M10 0 a4 4 0 110 8 a4 4 0 110 -8 M8 9 L12 9 L12 26 L22 10 L26 13 L14 30 L14 42 L20 54 L16 56 L11 45 L6 56 L2 54 L8 42 Z"/>
  </g>
  <!-- front mountain range -->
  <path d="M0 168 L60 148 L140 160 L220 140 L310 155 L400 135 L480 152 L570 138 L660 155 L740 142 L800 150 L800 180 L0 180 Z" fill="#1c1c1c"/>
</svg>`;

const STYLES = `
:host {
  --ssi-red: #e53935;
  --ssi-red-dark: #c62828;
  --ssi-paper: #e8e8e6;
  --ssi-card: #f3f2f0;
  --ssi-ink: #1c1c1c;
  --ssi-muted: #6a6a6a;
  --ssi-gold: #d4a82e;
  --ssi-black: #1a1a1a;
  display: inline-block;
  width: 100%;
  max-width: 440px;
  aspect-ratio: 440 / 900;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--ssi-ink);
  contain: layout style;
}
.frame {
  width: 100%;
  height: 100%;
  background: var(--ssi-paper);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 18px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.08);
}

/* --- Header --- */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px 10px;
}
.logo { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.logo .red { color: var(--ssi-red); }
.logo .speech {
  display: inline-block;
  width: 14px; height: 14px;
  background: var(--ssi-red);
  border-radius: 3px;
  position: relative;
  top: 2px;
  margin-left: 1px;
}
.logo .speech::after {
  content: '';
  position: absolute;
  bottom: -4px; left: 3px;
  border: 4px solid transparent;
  border-top-color: var(--ssi-red);
}
.lang-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: white;
  padding: 7px 14px 7px 9px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.lang-pill .flag { font-size: 17px; line-height: 1; }

/* --- Phrase card --- */
.phrase-card {
  margin: 12px 16px 10px;
  padding: 28px 20px;
  min-height: 98px;
  background: var(--ssi-card);
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.phrase-text {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.phrase-text.muted { opacity: 0; }

/* --- Mic card --- */
.mic-card {
  margin: 0 16px;
  padding: 36px 20px;
  background: var(--ssi-card);
  border-radius: 18px;
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
}
.mic-button {
  width: 116px; height: 116px;
  border-radius: 50%;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0,0,0,0.1);
  position: relative;
  transition: box-shadow 0.25s;
}
.mic-button.active {
  box-shadow: 0 0 0 4px var(--ssi-red);
}
.mic-icon {
  width: 46px; height: 46px;
  color: var(--ssi-red);
}
.mic-ring {
  position: absolute;
  inset: -6px;
  border: 4px solid var(--ssi-red);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.2s;
}
.mic-button.active .mic-ring { opacity: 1; }
.mic-ring.progress {
  border-color: transparent;
  border-top-color: var(--ssi-red);
  transition: transform 0.12s linear;
}

.timer {
  position: absolute;
  right: 18px;
  bottom: 18px;
  background: var(--ssi-red);
  color: white;
  padding: 8px 14px;
  border-radius: 10px;
  font-weight: 700;
  font-size: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.timer .stopwatch-icon { width: 18px; height: 18px; }

/* --- Belt / progress --- */
.belt-section {
  margin: 12px 16px 0;
  position: relative;
}
.belt-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 15px;
  margin-bottom: 10px;
}
.belt-check {
  width: 20px; height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--ssi-red);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ssi-red);
}
.belt-check::after {
  content: '✓';
  font-size: 12px;
  font-weight: 900;
}
.silhouettes {
  position: relative;
  width: 100%;
  height: 90px;
  margin-top: 6px;
  border-radius: 6px;
  overflow: hidden;
}
.silhouettes svg {
  width: 100%; height: 100%;
  display: block;
}
.progress-bar {
  position: absolute;
  bottom: 18px;
  left: 0; right: 0;
  height: 10px;
  background: #9a9a96;
  border-radius: 5px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: white;
  width: 0%;
  transition: width 0.4s;
}
.belt-indicator {
  position: absolute;
  top: -24px;
  left: 0;
  transform: translateX(-50%);
  transition: left 0.4s;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.belt-indicator .dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--ssi-black);
  margin-bottom: 0;
}
.belt-indicator .stem {
  width: 1.5px;
  height: 32px;
  background: var(--ssi-black);
}

/* --- Black bottom controls area --- */
.bottom-area {
  position: relative;
  background: var(--ssi-black);
  padding: 22px 16px 8px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 0;
}
.speed-limit-btn {
  position: absolute;
  right: 16px;
  top: -50px;
  width: 52px; height: 52px;
  border-radius: 12px;
  background: var(--ssi-red);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 3px 8px rgba(0,0,0,0.25);
}
.speed-limit-btn svg { width: 26px; height: 26px; }

.transport {
  background: #6a6a6a;
  border-radius: 100px;
  padding: 6px 10px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.transport button {
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.transport .side-btn {
  width: 48px; height: 48px;
  border-radius: 50%;
  background: white;
  color: var(--ssi-muted);
}
.transport .side-btn svg { width: 22px; height: 22px; }
.transport .main-btn {
  width: 60px; height: 60px;
  border-radius: 50%;
  background: var(--ssi-red);
  color: white;
}
.transport .main-btn svg { width: 26px; height: 26px; }

/* --- Nav --- */
.nav {
  background: var(--ssi-black);
  display: flex;
  padding: 8px 0 14px;
  justify-content: space-around;
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #7a7a7a;
  font-weight: 500;
  cursor: default;
}
.nav-item.active { color: var(--ssi-gold); }
.nav-item svg { width: 22px; height: 22px; }

/* --- End state --- */
.end-cta {
  position: absolute;
  inset: 0;
  background: rgba(232,232,230,0.96);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px;
  z-index: 10;
  animation: fadeIn 0.35s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.end-cta h2 { font-size: 28px; margin: 0 0 12px; letter-spacing: -0.02em; }
.end-cta p { font-size: 16px; color: var(--ssi-muted); margin: 0 0 24px; line-height: 1.45; }
.end-cta .cta-btn {
  background: var(--ssi-red);
  color: white;
  border: none;
  border-radius: 14px;
  padding: 14px 28px;
  font-size: 17px;
  font-weight: 700;
  cursor: pointer;
  text-decoration: none;
}
.end-cta .replay-btn {
  background: transparent;
  color: var(--ssi-muted);
  border: none;
  margin-top: 16px;
  font-size: 14px;
  cursor: pointer;
  text-decoration: underline;
}

/* --- Loading --- */
.loading, .error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ssi-muted);
  padding: 40px;
  text-align: center;
  font-size: 14px;
}
.error { color: var(--ssi-red); }
`;

// Audio reference sizing: "my" dynamic pause duration = 2× target duration
const PAUSE_MULTIPLIER = 2.0;
const GAP_BETWEEN_CYCLES_MS = 350;

class SsiLessonPlayer extends HTMLElement {
  static get observedAttributes() {
    return ['course', 'autoplay', 'manifest-src', 'audio-src'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._manifest = null;
    this._cycleIndex = 0;
    this._phase = 'idle'; // 'idle' | 'prompt' | 'pause' | 'voice1' | 'voice2' | 'gap' | 'ended'
    this._playing = false;
    this._audio = null;
    this._timers = [];
    this._elapsedSec = 0;
    this._elapsedTimer = null;
  }

  connectedCallback() { this._render(); this._load(); }
  attributeChangedCallback() { if (this._manifest) this._load(); }
  disconnectedCallback() { this._cleanup(); }

  _cleanup() {
    if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio = null; }
    this._timers.forEach(t => clearTimeout(t));
    this._timers = [];
    if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
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
    } catch (err) {
      this._showError(`Failed to load ${course}: ${err.message}`);
      return;
    }
    this._cycleIndex = 0;
    this._phase = 'idle';
    this._elapsedSec = 0;
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
    // Crude: 0.6s per target character, minimum 1.2s
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

  async _runCycle() {
    if (!this._playing || !this._manifest) return;
    if (this._cycleIndex >= this._manifest.cycles.length) {
      this._phase = 'ended';
      this._playing = false;
      this._render();
      return;
    }

    const cycle = this._manifest.cycles[this._cycleIndex];

    // Phase 1: PROMPT — show known text, play known audio
    this._phase = 'prompt';
    this._render();
    if (cycle.known_audio_id) {
      try { await this._playAudio(this._audioUrl(cycle.known_audio_id)); } catch (e) { /* continue */ }
    }
    if (!this._playing) return;

    // Phase 2: PAUSE — mic active, "your turn"
    this._phase = 'pause';
    this._render();
    const pauseMs = this._estimateDuration() * PAUSE_MULTIPLIER;
    await this._wait(pauseMs);
    if (!this._playing) return;

    // Phase 3: VOICE_1 — target audio, no text
    this._phase = 'voice1';
    this._render();
    if (cycle.target1_audio_id) {
      try { await this._playAudio(this._audioUrl(cycle.target1_audio_id)); } catch (e) { /* continue */ }
    }
    if (!this._playing) return;

    await this._wait(200);

    // Phase 4: VOICE_2 — target audio + text
    this._phase = 'voice2';
    this._render();
    if (cycle.target2_audio_id) {
      try { await this._playAudio(this._audioUrl(cycle.target2_audio_id)); } catch (e) { /* continue */ }
    }
    if (!this._playing) return;

    // Gap before next
    this._phase = 'gap';
    this._render();
    await this._wait(GAP_BETWEEN_CYCLES_MS);
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

  _render() {
    if (!this._manifest) {
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="frame"><div class="loading">Loading lesson…</div></div>`;
      return;
    }

    const m = this._manifest;
    const cycle = m.cycles[Math.min(this._cycleIndex, m.cycles.length - 1)];
    const showKnown = this._phase === 'prompt' || this._phase === 'pause' || this._phase === 'voice1';
    const showTarget = this._phase === 'voice2';
    const micActive = this._phase === 'pause';
    const belt = cycle?.belt_progress || 0;
    const beltPct = Math.round(belt * 100);
    const ended = this._phase === 'ended';

    const displayText = showKnown ? cycle?.known_text
                      : showTarget ? cycle?.target_text
                      : this._phase === 'idle' ? ''
                      : '';
    const textMuted = this._phase === 'idle' || this._phase === 'gap';
    const isPlayingMainBtn = this._playing;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="frame">
        <div class="header">
          <div class="logo"><span class="red">Say</span>Something<span class="red">in</span><span class="speech"></span></div>
          <div class="lang-pill"><span class="flag">${m.flag_emoji || '🏳️'}</span> ${m.target_name}</div>
        </div>

        <div class="phrase-card">
          <div class="phrase-text ${textMuted ? 'muted' : ''}">${displayText || '\u00A0'}</div>
        </div>

        <div class="mic-card">
          <div class="mic-button ${micActive ? 'active' : ''}">
            <div class="mic-ring"></div>
            <div class="mic-icon">${ICONS.mic}</div>
          </div>
          <div class="timer">
            <span class="stopwatch-icon">${ICONS.stopwatch}</span>
            <span class="timer-text">${this._formatTime(this._elapsedSec)}</span>
          </div>
        </div>

        <div class="belt-section">
          <div class="belt-label"><span class="belt-check"></span>White Belt - ${beltPct}%</div>
        </div>

        <div class="silhouettes">
          ${MARTIAL_SVG}
          <div class="progress-bar"><div class="progress-fill" style="width: ${beltPct}%"></div></div>
          <div class="belt-indicator" style="left: ${beltPct}%"><div class="dot"></div><div class="stem"></div></div>
        </div>

        <div class="bottom-area">
          <div class="speed-limit-btn" title="Speed">${ICONS.speedLimit}</div>
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

        ${ended ? `
          <div class="end-cta">
            <h2>This is your first minute.</h2>
            <p>Continue for just two weeks and you'll be holding real conversations. That's how SaySomethingin works.</p>
            <a class="cta-btn" href="https://saysomethingin.com/" target="_top">Get the full course</a>
            <button class="replay-btn" data-act="replay">Replay demo</button>
          </div>
        ` : ''}
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
}

// Register — guard against double-definition
if (!customElements.get('ssi-lesson-player')) {
  customElements.define('ssi-lesson-player', SsiLessonPlayer);
}

export default SsiLessonPlayer;
