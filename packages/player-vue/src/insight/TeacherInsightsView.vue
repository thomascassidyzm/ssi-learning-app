<script setup lang="ts">
// ============================================================================
// TeacherInsightsView.vue — thin plain-words wrapper over NodeRateEngine (THE
// LENS). Serves ALL THREE schools roles (teacher, school_admin, govt_admin) —
// the file/route names predate the real wiring and are kept for now.
//
// Founder ruling 2026-07-19 (THE LENS, phase 3): the Insight Engine IS the
// analytics lens everywhere, teacher included. This view owns exactly ONE
// control the engine doesn't have — "Your classes" (from GET
// /api/me/teaching-context, the ONE capability read the teacher shell already
// gates on) — and hands the selected class id to NodeRateEngine as its
// node-id. Course, compare-to, the metric readout and the widget itself are
// entirely the engine's; this view never forks them.
//
// Killed here: the ?demo fixture fork (MY_CLASSES/demoRates), the
// useClassesData/useSchoolContext/useSchoolData plumbing, and the direct
// /api/school/rate-compare fetch — all pre-MODEL. That plumbing is what
// produced the em-dash titles and "No classes yet" for a teacher who plainly
// had classes; teaching-context's classes_detail/groups_detail names kill
// the bug at the root (no useSchoolContext school-name lookup to desync).
// ============================================================================
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NodeRateEngine from './NodeRateEngine.vue'
import FrostSelect from '@/components/FrostSelect.vue'
import TopNav from '@/components/schools/shared/TopNav.vue'
import { getSchoolsClient } from '@/composables/schools/client'
import { isDemoMode } from '@/composables/demo/demoMode'
import '@/styles/schools-tokens.css'

// When `embedded`, this view renders INSIDE the schools shell (SchoolsContainer
// provides the SchoolsTopBar + the page scroll), so it must NOT render its own
// TopNav or impose its own full-viewport scroll. Standalone path is unchanged.
const props = defineProps<{ embedded?: boolean }>()

const route = useRoute()
const router = useRouter()

interface GroupDetail { id: string; label: 'school' | 'group'; name: string }
interface ClassDetail { id: string; name: string; course_code: string | null }
interface TeachingContext {
  groups: { id: string; label: 'school' | 'group' }[]
  classes: string[]
  can_play_as_class: boolean
  groups_detail: GroupDetail[]
  classes_detail: ClassDetail[]
}

async function getToken(): Promise<string | null> {
  try {
    const client = getSchoolsClient()
    const { data } = await client.auth.getSession()
    return data?.session?.access_token ?? null
  } catch {
    return null
  }
}

// ── Teaching context: the caller's own groups + classes, with display names
// (classes_detail / groups_detail) so this view never needs its own lookup. ──
const context = ref<TeachingContext | null>(null)
const isLoadingContext = ref(true)
const authMissing = ref(false)
const fetchFailed = ref(false)

async function loadContext(): Promise<void> {
  isLoadingContext.value = true
  authMissing.value = false
  fetchFailed.value = false
  try {
    const token = await getToken()
    if (!token) { authMissing.value = true; return }
    const res = await fetch('/api/me/teaching-context', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`teaching-context ${res.status}`)
    context.value = await res.json()
  } catch (e) {
    console.error('[TeacherInsightsView] teaching-context fetch failed:', e)
    fetchFailed.value = true
  } finally {
    isLoadingContext.value = false
  }
}
void loadContext()

const classOptions = computed<ClassDetail[]>(() => context.value?.classes_detail ?? [])
const hasNoClasses = computed(() => !!context.value && classOptions.value.length === 0)

// The one control this view owns: "Your classes" — never any class outside
// the caller's own teaching context. Deep-linkable via ?class=.
const selectedClassId = ref<string>(typeof route.query.class === 'string' ? route.query.class : '')
watch(classOptions, (opts) => {
  // Context not loaded yet (opts is still empty because context.value is
  // null) — keep whatever the route gave us rather than clobbering a
  // ?class= deep link before the fetch resolves.
  if (!context.value) return
  if (!opts.find((c) => c.id === selectedClassId.value)) selectedClassId.value = opts[0]?.id ?? ''
}, { immediate: true })
const classSelectOptions = computed(() => classOptions.value.map((c) => ({ value: c.id, label: c.name })))
const selectedClass = computed<ClassDetail | null>(
  () => classOptions.value.find((c) => c.id === selectedClassId.value) ?? null,
)

// ── Course / compare / window / measure — mirrored into the route query so
// the view is deep-linkable. The engine resolves defaults server-side and
// reflects them back up via v-model. Local refs + ONE coalesced replace for
// all five params — separate per-param query-setters raced each other (each
// replace read the pre-replace query and clobbered the other's write). ──
const course = ref<string | null>(typeof route.query.course === 'string' ? route.query.course : null)
const compare = ref<string | null>(typeof route.query.compare === 'string' ? route.query.compare : null)
const window_ = ref<string | null>(typeof route.query.window === 'string' ? route.query.window : null)
const measure = ref<string | null>(typeof route.query.measure === 'string' ? route.query.measure : null)
watch([selectedClassId, course, compare, window_, measure], ([cls, c, cmp, w, m]) => {
  void router.replace({
    query: {
      ...route.query,
      class: cls || undefined,
      course: c || undefined,
      compare: cmp || undefined,
      window: w || undefined,
      measure: m || undefined,
    },
  })
})

// ── Plain-words header: "Your class", the class name, the school/group name
// straight from teaching-context — no school-name lookup of its own, so it
// can't desync from the engine's own resolution the way the old
// useSchoolContext-driven header could. ──
const ownerGroupName = computed(() => context.value?.groups_detail?.find((g) => g.name)?.name || null)
const headerTitle = computed(() => {
  const cls = selectedClass.value
  if (!cls) return '—'
  return ownerGroupName.value ? `${ownerGroupName.value} · ${cls.name}` : cls.name
})

// ── Old deep link from the Students table: ?scope=learner&name=<display>.
// Per-learner rates aren't wired yet (homework-sourced attention lane,
// tutor-insights.md §4) — show the class view instead with a quiet, honest
// note rather than a seeded preview. ──
const isLearnerDeepLink = computed(() => route.query.scope === 'learner')
const requestedLearnerName = computed(() => {
  const n = route.query.name
  return (Array.isArray(n) ? n[0] : n) || ''
})
</script>

<template>
  <!-- Single root wrapper — this view used to render TopNav and .tiv-scroll
       as two sibling roots (a fragment component), which the schools shell's
       page transition can't animate/track cleanly ("renders non-element root
       node that cannot be animated"). A plain block div here is
       layout-neutral: TopNav is position:fixed and .tiv-scroll is
       height:100vh, so nesting them one level deeper changes nothing. -->
  <div class="tiv-root">
    <!-- The teacher's dashboard nav is present in the standalone page; when
         embedded the schools shell (SchoolsTopBar) provides it instead. -->
    <TopNav v-if="!props.embedded" :force-tabs="true" />

    <div :class="['tiv-scroll', { 'tiv-scroll--embedded': props.embedded }]">
    <div class="tiv schools-surface">
    <!-- ── Honest states before there's anything to show ── -->
    <div v-if="isLoadingContext" class="tiv-status-card">
      <p>Loading your classes…</p>
    </div>
    <!-- Demo mode (guided missions): no session, but "sign in" would be a
         dead end here — say honestly what this view is and isn't yet. -->
    <div v-else-if="authMissing && isDemoMode" class="tiv-status-card">
      <p v-if="isLearnerDeepLink && requestedLearnerName">
        Opened for <strong>{{ requestedLearnerName }}</strong> — per-learner rate insights are still
        being wired up. In the live app, this is where their pace would sit against the class.
      </p>
      <p v-else>Demo mode — live class rates need a signed-in teacher.</p>
    </div>
    <div v-else-if="authMissing" class="tiv-status-card">
      <p>Sign in to see your class's rate.</p>
    </div>
    <div v-else-if="fetchFailed" class="tiv-status-card">
      <p>Couldn't load your classes just now — try again shortly.</p>
    </div>
    <div v-else-if="hasNoClasses" class="tiv-status-card">
      <p>No classes yet — once you have a class with sessions, it compares here.</p>
    </div>

    <!-- ── Calm, minimal teacher header + the engine ── -->
    <template v-else>
      <header class="tiv-head">
        <div class="tiv-head-top">
          <span class="tiv-kicker">Your class</span>
        </div>
        <h1 class="tiv-title">{{ headerTitle }}</h1>
        <p class="tiv-sub">
          How your class is doing, compared with the average.
        </p>
        <p v-if="isLearnerDeepLink && requestedLearnerName" class="tiv-preview-note">
          Opened for <strong>{{ requestedLearnerName }}</strong> — per-learner rates aren't available
          yet, so this shows the whole class instead.
        </p>
      </header>

      <div v-if="classSelectOptions.length > 1" class="tiv-controls">
        <label class="tiv-field tiv-field-wide">
          <span class="tiv-field-label">Your classes</span>
          <FrostSelect v-model="selectedClassId" :options="classSelectOptions" aria-label="Your classes" />
        </label>
      </div>

      <NodeRateEngine
        v-if="selectedClassId"
        v-model:course="course"
        v-model:compare="compare"
        v-model:window="window_"
        v-model:measure="measure"
        :node-id="selectedClassId"
        :plain-words="true"
        :get-token="getToken"
      />
    </template>
  </div>
  </div>
  </div>
</template>

<style scoped>
/* .tiv-root: deliberately plain block (default display) — NOT
 * display:contents. That generates no box, so it never paints and its
 * `transitionend` never fires, which broke the schools shell's page
 * transition (SchoolsContainer.vue) when leaving this route. */

/* ============================================================================
 * ROLE TOKENS — the small palette every coloured element references. ONE green/
 * blue scheme (no look switcher): each token is an "r, g, b" triplet consumed as
 * rgba(var(--rc-…), α). Semantics: blue = primary/selection, green = success/
 * active, gold = warning (--tone-gold, unchanged).
 * ============================================================================ */

/* Full-width scroll container. The app shell pins body { overflow: hidden } so
 * the player can't scroll-bounce — which means any long content page must own
 * its OWN scroll. The grey canvas shows at the sides; the .tiv column keeps the
 * green/blue atmosphere. */
.tiv-scroll {
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--bg-primary, #e8e3dd);
  /* Clear the fixed TopNav so content starts below it. */
  padding-top: calc(var(--nav-height, 80px) + env(safe-area-inset-top, 0px));
}

/* Embedded inside SchoolsContainer: the shell owns the top bar AND the page
 * scroll, so drop the full-viewport height, the own overflow, and the
 * nav-clearing padding. The content just flows in the shell's content area. */
.tiv-scroll--embedded {
  height: auto;
  min-height: 0;
  overflow-y: visible;
  padding-top: 0;
  background: transparent;
}
.tiv-scroll--embedded .tiv {
  min-height: 0;
}

.tiv {
  --rc-entity:     96, 165, 250;
  --rc-entity-ink: 37, 99, 235;
  --rc-positive:   21, 128, 61;
  --rc-secondary:  138, 128, 120;
  --rc-band:       74, 222, 128;
  --rc-glow:       96, 165, 250;

  max-width: 980px;
  margin: 0 auto;
  padding: 32px 24px 56px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: calc(100dvh - var(--nav-height, 80px));
  position: relative;
  isolation: isolate;
  /* the soft green/blue colour atmosphere UNDER the content, so the glass
   * chrome floating above it has real colour to refract. Light, not heavy:
   * ~12-20% tints fading to transparent. */
  background:
    radial-gradient(760px 400px at 16% -8%, rgba(74, 222, 128, 0.20), transparent 60%),
    radial-gradient(720px 380px at 92% 2%, rgba(96, 165, 250, 0.20), transparent 58%),
    radial-gradient(900px 520px at 55% 112%, rgba(96, 165, 250, 0.12), transparent 60%),
    var(--schools-bg, #f6f5f1);
}

/* ── Header (glass chrome) ── */
.tiv-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 22px 16px;
  /* regular-material glass: light, lit by edges + sheen, not heavy opacity */
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    0 1px 2px rgba(44, 38, 34, 0.05),
    0 10px 28px rgba(44, 38, 34, 0.10);
}
/* One subtle brand mark — a short blue rule under the header block. */
.tiv-head::after {
  content: '';
  width: 40px;
  height: 2px;
  margin-top: 4px;
  border-radius: 1px;
  background: rgba(var(--rc-entity), 0.9);
  box-shadow: 0 0 10px rgba(var(--rc-glow), 0.35);
}
.tiv-head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.tiv-kicker {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(var(--rc-entity-ink), 1);
}

.tiv-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(26px, 4vw, 38px);
  line-height: 1.06;
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 4px 0 2px;
}
.tiv-sub {
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink-secondary);
  max-width: 56ch;
  margin: 0;
}

/* Deep-link preview note — a quiet honest line when arriving from a student's
 * "View →" before per-learner data is wired. */
.tiv-preview-note {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-secondary);
  background: rgba(var(--rc-entity), 0.08);
  border: 1px solid rgba(var(--rc-entity), 0.2);
  border-radius: 10px;
  padding: 9px 12px;
  margin: 2px 0 0;
  max-width: 56ch;
}
.tiv-preview-note strong { color: rgba(var(--rc-entity-ink), 1); }

/* ── Controls bar (glass chrome) — this view's ONE control, "Your classes";
 * course/compare live inside NodeRateEngine's own controls bar. ── */
.tiv-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 16px;
  padding: 16px 18px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    0 1px 2px rgba(44, 38, 34, 0.05),
    0 10px 28px rgba(44, 38, 34, 0.10);
}
.tiv-field { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
.tiv-field-wide { flex: 1 1 220px; min-width: 220px; }
.tiv-field-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}

/* ── This view's own honest states (loading context / auth / fetch-failed /
 * zero classes) — the engine has its own equivalent states for once a class
 * IS selected but its own fetch fails. ── */
.tiv-status-card {
  padding: 24px 26px;
  background: #ffffff;
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: 18px;
  box-shadow:
    0 1px 2px rgba(44, 38, 34, 0.05),
    0 14px 34px rgba(44, 38, 34, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  text-align: center;
}
.tiv-status-card p {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink-secondary);
  max-width: 42ch;
  margin: 0;
}

/* ── Responsive ── */
@media (max-width: 720px) {
  .tiv-field, .tiv-field-wide { width: 100%; min-width: 0; }
}

/* ── Accessibility ── */
@media (prefers-reduced-transparency: reduce) {
  .tiv-head,
  .tiv-controls {
    background: rgba(255, 255, 255, 0.94) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tiv *,
  .tiv *::before,
  .tiv *::after {
    transition: none !important;
    animation: none !important;
  }
}
</style>
