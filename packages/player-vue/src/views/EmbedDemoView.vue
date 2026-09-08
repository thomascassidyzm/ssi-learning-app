<script setup lang="ts">
/**
 * EmbedDemoView — the framed marketing demo. `/embed/demo?course=…&minutes=…&s=…`
 *
 * ONE page, framed by a saysomethingin.com landing page, showing the real
 * product: the app's own playback engine (SimplePlayer), the real cycles the
 * live database serves, the real audio, the app's own translated chrome in the
 * course's KNOWN language. Not a replica — the spec's candidate D exists
 * precisely so there is no second player to keep true.
 *
 * STATELESS ON PURPOSE. No service worker, no sign-in, no bundle, nothing
 * written to storage, no microphone. Playing it twice gives the same thing
 * twice, and the demo can never hand a visitor an entitlement. The boot
 * side-effects that would break that are suppressed upstream — see
 * platform/embedMode.ts, App.vue and main.js.
 *
 * WHAT IT TALKS TO. Exactly one endpoint, with NO Authorization header:
 * /api/courses/:code/cycles. The server slices an anonymous caller to the free
 * introductory window (through Yellow Belt) and marks the body edge-cacheable
 * for five minutes, so the database is asked once per five minutes per course
 * rather than once per visitor. Audio streams from /api/audio/:id as it does
 * everywhere else, same-origin inside the frame.
 *
 * NO NEW USER-VISIBLE STRINGS. Every word on this page is an EXISTING
 * translated key, so the nine India languages are already covered and no
 * proofreading round-trip is created by this page existing. The end card's
 * headline is not a marketing sentence at all — it is the last target sentence
 * the visitor just heard, which is real course content and therefore already
 * in the right language by construction.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import { SimplePlayer, type Phase } from '@/playback/SimplePlayer'
import type { Round, Cycle } from '@/playback/SimplePlayer'
import { backendCyclesToRounds } from '@/providers/backendCyclesToRounds'
import type { BackendCycle, RoundMap } from '@/composables/useInstantPlayback'
import { apiUrl } from '@/platform/apiBase'

const { t } = useI18n()
const route = useRoute()

/** Origins this demo is ever framed by. Our own harness at
 *  /_embed-harness/ is same-origin, which is why location.origin is in the
 *  list: without it the page Tom looks at cannot see the page it frames. */
const PARENT_ORIGINS = [
  'https://www.saysomethingin.com',
  'https://saysomethingin.com',
]

/** Where every course's script starts. */
const FIRST_LEGO = 'S0001L01'
/** One window is ~50 cycles ≈ 9 minutes of play. Bounded so a 30-minute demo
 *  cannot turn into an unbounded fetch loop on a bad course. */
const MAX_WINDOWS = 6

type Screen = 'loading' | 'ready' | 'playing' | 'done' | 'unavailable'

const screen = ref<Screen>('loading')
const phase = ref<Phase>('idle')
const cycle = ref<Cycle | null>(null)
/** The last target sentence heard — the end card's headline. */
const lastTargetText = ref('')

const courseCode = computed(() => {
  const raw = route.query.course
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
})

/** 3 or 30. Anything else is 3 — the landing pages' default and the safe one. */
const minutes = computed(() => (route.query.minutes === '30' ? 30 : 3))

/** The marketing cohort tag. NEVER interpreted, only carried through to the
 *  single outbound link, so the page's existing attribution is not broken. */
const cohortTag = computed(() => {
  const raw = route.query.s
  return typeof raw === 'string' ? raw.slice(0, 64) : ''
})

/**
 * The one way out. Same ORIGIN as this frame deliberately: on dev it points at
 * dev, in production at production, so what is being reviewed is always the
 * deployment being reviewed.
 */
const deepLink = computed(() => {
  const url = new URL('/', location.origin)
  if (courseCode.value) url.searchParams.set('course', courseCode.value)
  if (cohortTag.value) url.searchParams.set('s', cohortTag.value)
  return url.toString()
})

/** Target text is withheld until VOICE_2 — the whole point of the cycle. */
const showTarget = computed(() => phase.value === 'voice2')

// --- the parent handshake -------------------------------------------------
let announced = false
function announce(state: 'ready' | 'unavailable'): void {
  if (announced) return
  announced = true
  if (window.parent === window) return // not framed; nothing to tell
  const message = { type: 'ssi-demo', state }
  // Explicit target origins rather than '*', so the message cannot be read by
  // a page that framed us without permission. One post per allowed origin:
  // postMessage silently drops the ones that do not match the real parent.
  for (const origin of [...PARENT_ORIGINS, location.origin]) {
    try {
      window.parent.postMessage(message, origin)
    } catch {
      /* a mismatched origin is the normal case for all but one of these */
    }
  }
}

function fail(): void {
  screen.value = 'unavailable'
  announce('unavailable')
}

// --- the content ----------------------------------------------------------
let player: SimplePlayer | null = null
let nextLegoId: string | null = FIRST_LEGO
let windowsFetched = 0
let budgetTimer: ReturnType<typeof setTimeout> | null = null

const buffer = new Map<string, BackendCycle[]>()
/** Round key order, first-seen. A synthesised round map — the real one lives
 *  behind /round-map, which this page has no reason to fetch: the cycles it
 *  holds ARE its whole world. */
const roundOrder: Array<{ legoId: string; seed: number }> = []

async function fetchWindow(): Promise<BackendCycle[] | null> {
  if (!nextLegoId || windowsFetched >= MAX_WINDOWS) return null
  const url = apiUrl(
    `/api/courses/${encodeURIComponent(courseCode.value)}/cycles?from=${nextLegoId}&limit=50`,
  )
  // NO Authorization header, deliberately and permanently: it is what makes
  // this body the shared, edge-cached, free-window one.
  const res = await fetch(url)
  if (!res.ok) return null
  const body = (await res.json()) as {
    cycles: BackendCycle[]
    next_lego_id: string | null
  }
  windowsFetched += 1
  nextLegoId = body.next_lego_id
  for (const c of body.cycles || []) {
    const key = c.round_lego_id ?? c.lego_id
    if (!buffer.has(key)) {
      buffer.set(key, [])
      roundOrder.push({ legoId: key, seed: c.seed_number })
    }
    buffer.get(key)!.push(c)
  }
  return body.cycles || []
}

function buildRounds(): Round[] {
  const roundMap: RoundMap = {
    course_code: courseCode.value,
    version: 0,
    rounds: roundOrder.map((e, i) => ({ r: i + 1, legoId: e.legoId, seed: e.seed })),
  }
  return backendCyclesToRounds(
    (legoId) => buffer.get(legoId) ?? [],
    roundMap,
    // The tail LEGO of a window is usually partial — next_lego_id points back
    // at it. Emitting it now would freeze it at its partial size, because
    // appendRounds dedupes by round number.
    (legoId) => legoId !== nextLegoId,
    // Flat 1.0x. The per-course speed ramp lives on courses.voice_config,
    // which only the entitlement-gated bundle endpoint carries; the demo
    // plays at the pace the clips were recorded at rather than fetching a
    // multi-megabyte bundle to shade it. Flagged deliberately.
    {},
  )
}

/** Top up while playing, so a 30-minute demo fetches windows as it goes
 *  rather than downloading its whole budget before the first sound. */
async function topUp(): Promise<void> {
  if (!player || !nextLegoId) return
  const { round, totalRounds } = player.progress
  if (totalRounds - round > 2) return
  const before = player.roundCount
  const got = await fetchWindow()
  if (!got) return
  const rounds = buildRounds()
  if (rounds.length > before) player.appendRounds(rounds.slice(before))
}

async function boot(): Promise<void> {
  if (!courseCode.value) return fail()
  let first: BackendCycle[] | null = null
  try {
    first = await fetchWindow()
  } catch {
    return fail()
  }
  if (!first || first.length === 0) return fail()

  const rounds = buildRounds()
  if (rounds.length === 0 || rounds[0].cycles.length === 0) return fail()

  player = new SimplePlayer(rounds)
  player.on('phase_changed', () => {
    if (!player) return
    phase.value = player.currentState.phase
    const c = player.currentCycle
    if (c) {
      cycle.value = c
      if (c.target?.text) lastTargetText.value = c.target.text
    }
  })
  player.on('cycle_completed', () => void topUp())
  player.on('session_complete', () => finish())

  screen.value = 'ready'
  // The first cycle is playable — that, not the first sound, is what the
  // parent is waiting to hear so it can reveal the frame.
  announce('ready')
}

function start(): void {
  if (!player) return
  screen.value = 'playing'
  // The minute budget is wall-clock from the tap. Honest, and it needs no
  // estimate of how long a cycle will take to sound on this connection.
  budgetTimer = setTimeout(finish, minutes.value * 60_000)
  player.play()
}

function finish(): void {
  if (budgetTimer) {
    clearTimeout(budgetTimer)
    budgetTimer = null
  }
  player?.stop()
  screen.value = 'done'
}

onMounted(() => {
  // Fail closed on our own account too: a boot that hangs past ten seconds is
  // the same to the parent as one that threw, and the parent's own timer is
  // the backstop rather than the only guard.
  const guard = setTimeout(() => {
    if (screen.value === 'loading') fail()
  }, 10_000)
  void boot().finally(() => clearTimeout(guard))
})

onBeforeUnmount(() => {
  if (budgetTimer) clearTimeout(budgetTimer)
  player?.stop()
  player?.dispose()
  player = null
})
</script>

<template>
  <div class="embed-demo" :class="`embed-demo--${screen}`">
    <!-- UNAVAILABLE renders nothing at all, deliberately: the parent removes
         the frame and its own placeholder becomes the permanent state. A
         "sorry" card here would flash and then be deleted. -->
    <template v-if="screen === 'loading'">
      <p class="embed-demo__muted">{{ t('resting.loading') }}</p>
    </template>

    <template v-else-if="screen === 'ready'">
      <button class="embed-demo__start" type="button" @click="start">
        {{ t('player.tapToStart') }}
      </button>
    </template>

    <template v-else-if="screen === 'playing'">
      <p class="embed-demo__known">{{ cycle?.known?.text }}</p>
      <p v-if="showTarget" class="embed-demo__target">{{ cycle?.target?.text }}</p>
      <p v-else class="embed-demo__target embed-demo__target--held" aria-hidden="true">&nbsp;</p>
    </template>

    <template v-else-if="screen === 'done'">
      <p class="embed-demo__target">{{ lastTargetText }}</p>
      <!-- The ONE outbound link, opened in the TOP window rather than inside
           the frame, carrying the cohort tag through unchanged. -->
      <a class="embed-demo__cta" :href="deepLink" target="_top" rel="noopener">
        {{ t('redeem.startLearning') }}
      </a>
    </template>
  </div>
</template>

<style scoped>
/* Fills the frame exactly and NEVER scrolls: a demo page that grows a
   scrollbar of its own has broken the spec it was built to. */
.embed-demo {
  position: fixed;
  inset: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding: 1.5rem;
  text-align: center;
  background: var(--bg-primary, #e8e3dd);
  color: var(--text-primary, #22201d);
  font-family: var(--font-body, system-ui, sans-serif);
}

.embed-demo--unavailable {
  background: transparent;
}

.embed-demo__muted {
  opacity: 0.6;
  font-size: 1rem;
}

.embed-demo__known {
  font-size: clamp(1.4rem, 6vw, 2rem);
  font-weight: 600;
  margin: 0;
  line-height: 1.3;
}

.embed-demo__target {
  font-size: clamp(1.2rem, 5vw, 1.7rem);
  margin: 0;
  line-height: 1.3;
  opacity: 0.85;
}

.embed-demo__target--held {
  visibility: hidden;
}

.embed-demo__start,
.embed-demo__cta {
  display: inline-block;
  border: 0;
  border-radius: 999px;
  padding: 0.9rem 2rem;
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  background: var(--accent, #2f6f5e);
  color: #fff;
}
</style>
