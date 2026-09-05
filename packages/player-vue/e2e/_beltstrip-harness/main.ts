/**
 * Belt-strip harness — mounts the REAL ProgressModal with the REAL stylesheet,
 * so the padlock/waiting states can be screenshotted and hit-tested in a
 * browser at a phone viewport. Not shipped: this entry is only ever built by
 * the verification probe beside it.
 */
import { createApp, h } from 'vue'
import ProgressModal from '../../src/components/ProgressModal.vue'
import { BELTS } from '../../src/composables/useBeltProgress'
import '../../src/styles/design-tokens.css'

const empty = { minutes: 0, learners: 0 }
const data = {
  targetLanguage: 'jpn',
  languageName: 'Japanese',
  global: { today: empty, days7: empty, days30: empty, allTime: empty },
  user: { today: empty, days7: empty, days30: empty, allTime: empty },
} as any

const params = new URLSearchParams(location.search)
const state = params.get('state') || 'paywalled'

// PAYWALLED: a guest on a premium course — free through Yellow (seed 19), so
// Orange..Black are the belts money would fix.
const paywalled = new Set(BELTS.filter((b) => b.seedsRequired > 19).map((b) => b.name))
// AWAITING: content still coming down for Green..Black.
const awaiting = new Set(BELTS.filter((b) => b.seedsRequired >= 40).map((b) => b.name))

const props: Record<string, unknown> = {
  isOpen: true,
  data,
  currentBelt: BELTS[1],
  knownLang: 'eng',
  currentRound: 12,
  highestRound: 12,
  currentBeltIndex: 1,
  highestBeltIndex: 1,
}
if (state === 'paywalled') props.paywalledBeltNames = paywalled
if (state === 'awaiting') { props.isOffline = true; props.beltsAwaitingDownload = awaiting }
if (state === 'both') {
  props.paywalledBeltNames = paywalled
  props.isOffline = true
  props.beltsAwaitingDownload = awaiting
}

document.documentElement.setAttribute('data-theme', 'mist')
createApp({ render: () => h(ProgressModal as any, props) }).mount('#app')
