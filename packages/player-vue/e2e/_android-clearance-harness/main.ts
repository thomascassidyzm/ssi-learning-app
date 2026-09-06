/**
 * Bottom-clearance harness — mounts the REAL BottomNav (and the ModeTray that
 * floats above it) with the REAL design tokens, so the probe beside it can
 * hit-test every control at a simulated system-bar inset.
 *
 * WHY THE INJECTION IS HONEST. The probe sets `--safe-area-inset-bottom` on
 * <html>. That is not a stub of the mechanism: it is the exact custom property
 * Capacitor's SystemBars plugin sets on a real Android device (Cap 8,
 * insetsHandling: 'css'), and --shell-inset-bottom is DEFINED as
 * `var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))`. Setting it
 * simulates Capacitor exactly. What this cannot verify is that Capacitor sets
 * it at all on Deborah's handset — that is what the read-out on the Settings
 * build card is for.
 *
 * Not shipped: this entry is only ever built by the probe.
 */
import { createApp, h } from 'vue'
import BottomNav from '../../src/components/BottomNav.vue'
import '../../src/styles/design-tokens.css'

const params = new URLSearchParams(location.search)

document.documentElement.setAttribute('data-theme', 'mist')

// The Android native shell's clearance rule. Set here rather than by importing
// platform/shellSafeArea because the harness has no native shell to detect —
// the probe is testing the LAYOUT the attribute switches on.
if (params.get('android') !== '0') {
  document.documentElement.setAttribute('data-shell-android', '1')
  document.documentElement.style.setProperty('--shell-nav-floor', params.get('floor') || '24px')
}

// `legacy=1` restores the PRE-FIX rule verbatim, so the probe can prove itself
// in both directions — a hit-test that has only ever been seen passing is not
// evidence. See the negative control at the end of probe.mjs.
if (params.get('legacy') === '1') {
  document.documentElement.style.setProperty(
    '--shell-nav-clearance',
    'max(calc(var(--shell-inset-bottom) / 2), 12px)'
  )
}

const inset = params.get('inset')
if (inset !== null) {
  document.documentElement.style.setProperty('--safe-area-inset-bottom', inset)
  document.documentElement.style.setProperty('--safe-area-inset-top', inset)
}

// Every control visible: the five pill/centre buttons plus the mode tray.
const props = {
  currentScreen: 'player',
  isLearning: true,
  isPlaying: true,
  isPlayerReady: true,
  showListeningBtn: true,
  showPronunciationBtn: true,
  courseCode: 'spa_for_eng',
} as Record<string, unknown>

createApp({ render: () => h(BottomNav as any, props) }).mount('#app')
