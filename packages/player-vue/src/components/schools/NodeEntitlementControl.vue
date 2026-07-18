<script setup lang="ts">
// NodeEntitlementControl — the binary entitlement control for ONE node
// (THE-MODEL.md §1.11, founder-ruled 2026-07-18): "there are only two
// options: all courses (if paid up), X_for_Y (if on a trial)." Kills the
// 150-course checkbox wall. Self-contained: fetches its own current grant,
// its own course catalogue, and posts its own save — the host panel only
// needs to pass {nodeId, nodeType}.
import { ref, computed, watch, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import FrostCard from './shared/FrostCard.vue'
import Button from './shared/Button.vue'
import SearchBox from './shared/SearchBox.vue'
import Badge from './shared/Badge.vue'

type NodeType = 'group' | 'school' | 'class'
type EntitlementState = 'trial' | 'paid'

interface Props {
  nodeId: string
  nodeType: NodeType
}
const props = defineProps<Props>()

interface Grant {
  id: string
  state: EntitlementState | null
  granted_courses: string[]
  expires_at: string | null
}

interface CatalogueCourse {
  course_code: string
  display_name: string | null
  known_lang: string
  target_lang: string
  pricing_tier: string | null
}

// Mirrors api/entitlement/grant.ts's server-side derivation exactly — this is
// a PREVIEW only (the server recomputes and is the source of truth on save).
const TRIAL_PREMIUM_DAYS = 30
const TRIAL_FREE_DAYS = 365
function trialDaysFor(c: CatalogueCourse): number {
  const isFree = c.pricing_tier === 'free' || c.pricing_tier === 'community'
  return isFree ? TRIAL_FREE_DAYS : TRIAL_PREMIUM_DAYS
}

const { getClient, getAuthToken } = useAdminClient()

const isLoading = ref(true)
const isSaving = ref(false)
const error = ref<string | null>(null)

const currentGrant = ref<Grant | null>(null)
const courses = ref<CatalogueCourse[]>([])
const courseSearch = ref('')

// Legacy rows predating this ruling have state = NULL. Used for DISPLAY only
// — a length-based guess (1 course => reads as trial, >1 => reads as paid).
// Saving always writes an explicit state; nothing is auto-migrated.
const displayState = computed<EntitlementState | 'none'>(() => {
  const g = currentGrant.value
  if (!g) return 'none'
  if (g.state === 'trial' || g.state === 'paid') return g.state
  if (g.granted_courses.length === 1) return 'trial'
  if (g.granted_courses.length > 1) return 'paid'
  return 'none'
})

const pendingState = ref<EntitlementState>('trial')
const pendingCourseCode = ref<string | null>(null)

watch(displayState, (val) => {
  if (val === 'none') return
  pendingState.value = val
  pendingCourseCode.value = val === 'trial' ? (currentGrant.value?.granted_courses[0] ?? null) : null
}, { immediate: true })

const LANG_NAMES: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian',
  por: 'Portuguese', zho: 'Chinese', jpn: 'Japanese', ara: 'Arabic', kor: 'Korean',
  cym: 'Welsh', gle: 'Irish', gla: 'Scottish Gaelic', bre: 'Breton', eus: 'Basque',
  cat: 'Catalan', cor: 'Cornish', glv: 'Manx', nld: 'Dutch', swe: 'Swedish',
  nor: 'Norwegian', fin: 'Finnish', pol: 'Polish', tur: 'Turkish', hin: 'Hindi',
  tha: 'Thai', vie: 'Vietnamese', ukr: 'Ukrainian', ron: 'Romanian', bul: 'Bulgarian',
  hrv: 'Croatian', ces: 'Czech', ell: 'Greek', heb: 'Hebrew', hun: 'Hungarian',
  ind: 'Indonesian', lav: 'Latvian', lit: 'Lithuanian', mkd: 'Macedonian', slk: 'Slovak',
  slv: 'Slovenian', srp: 'Serbian', tam: 'Tamil', sin: 'Sinhala', aze: 'Azerbaijani',
  isl: 'Icelandic', swa: 'Swahili', nep: 'Nepali',
}
function langName(code: string): string {
  return LANG_NAMES[code] || code
}
function courseXForY(c: CatalogueCourse): string {
  return `${langName(c.target_lang)} for ${langName(c.known_lang)} speakers`
}
function courseLabel(c: CatalogueCourse): string {
  return c.display_name || courseXForY(c)
}

const courseByCode = computed(() => new Map(courses.value.map((c) => [c.course_code, c])))

function formatCourseCode(code: string): string {
  return code.replace(/_/g, ' ')
}

const currentTrialCourse = computed(() => {
  const g = currentGrant.value
  if (!g || displayState.value !== 'trial') return null
  const code = g.granted_courses[0]
  if (!code) return null
  const c = courseByCode.value.get(code)
  return { code, label: c ? courseXForY(c) : formatCourseCode(code) }
})

const filteredCourses = computed(() => {
  const q = courseSearch.value.toLowerCase().trim()
  if (!q) return courses.value
  return courses.value.filter((c) =>
    courseLabel(c).toLowerCase().includes(q) ||
    c.course_code.toLowerCase().includes(q) ||
    langName(c.known_lang).toLowerCase().includes(q) ||
    langName(c.target_lang).toLowerCase().includes(q)
  )
})

function selectTrialCourse(code: string): void {
  pendingCourseCode.value = code
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'no expiry'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const nodeQueryKey = computed(() => `${props.nodeType}_id`)

async function fetchCourses(): Promise<void> {
  try {
    const client = getClient()
    const { data, error: fetchErr } = await client
      .from('courses')
      .select('course_code, display_name, known_lang, target_lang, pricing_tier')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')
    if (fetchErr) throw fetchErr
    courses.value = data || []
  } catch (err) {
    console.error('[NodeEntitlementControl] fetch courses error:', err)
  }
}

async function fetchGrant(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const response = await fetch(`/api/entitlement/grants?${nodeQueryKey.value}=${props.nodeId}`, { headers })
    if (!response.ok) throw new Error('Failed to load course access')
    const data = await response.json()
    currentGrant.value = data.grants?.[0] ?? null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load course access'
  } finally {
    isLoading.value = false
  }
}

async function save(): Promise<void> {
  if (pendingState.value === 'trial' && !pendingCourseCode.value) {
    error.value = 'Pick a course for the trial'
    return
  }
  isSaving.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const body: Record<string, unknown> = {
      [nodeQueryKey.value]: props.nodeId,
      state: pendingState.value,
    }
    if (pendingState.value === 'trial') body.course_code = pendingCourseCode.value
    const response = await fetch('/api/entitlement/grant', { method: 'POST', headers, body: JSON.stringify(body) })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to save course access')
    }
    const result = await response.json()
    currentGrant.value = result.grant
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save course access'
  } finally {
    isSaving.value = false
  }
}

onMounted(() => {
  fetchGrant()
  fetchCourses()
})
</script>

<template>
  <FrostCard variant="panel" class="node-entitlement">
    <div class="facet-head">
      <span class="schools-kicker">Courses</span>
      <span v-if="displayState === 'trial'" class="status-pill tone-gold"><span class="status-dot"></span>Trial</span>
      <span v-else-if="displayState === 'paid'" class="status-pill tone-green"><span class="status-dot"></span>Paid</span>
      <span v-else class="status-pill tone-muted"><span class="status-dot"></span>Not set</span>
    </div>

    <p v-if="isLoading" class="facet-hint">Loading…</p>
    <template v-else>
      <p v-if="displayState === 'trial' && currentTrialCourse" class="current-summary">
        {{ currentTrialCourse.label }} — expires {{ formatExpiry(currentGrant?.expires_at ?? null) }}
      </p>
      <p v-else-if="displayState === 'paid'" class="current-summary">All courses, no expiry.</p>
      <p v-else class="facet-hint">No course access set yet.</p>

      <div class="state-toggle" role="radiogroup" aria-label="Course access state">
        <button
          type="button"
          class="state-option"
          :class="{ 'is-selected': pendingState === 'trial' }"
          role="radio"
          :aria-checked="pendingState === 'trial'"
          @click="pendingState = 'trial'"
        >
          Trial
        </button>
        <button
          type="button"
          class="state-option"
          :class="{ 'is-selected': pendingState === 'paid' }"
          role="radio"
          :aria-checked="pendingState === 'paid'"
          @click="pendingState = 'paid'"
        >
          Paid
        </button>
      </div>

      <div v-if="pendingState === 'trial'" class="trial-picker">
        <SearchBox v-model="courseSearch" placeholder="Search courses…" size="sm" block />
        <div class="course-list">
          <button
            v-for="c in filteredCourses"
            :key="c.course_code"
            type="button"
            class="course-option"
            :class="{ 'is-selected': pendingCourseCode === c.course_code }"
            @click="selectTrialCourse(c.course_code)"
          >
            {{ courseLabel(c) }}
          </button>
          <p v-if="filteredCourses.length === 0" class="facet-hint">No courses match.</p>
        </div>
        <p v-if="pendingCourseCode && courseByCode.get(pendingCourseCode)" class="expiry-preview">
          Auto-expiry: {{ trialDaysFor(courseByCode.get(pendingCourseCode)!) }} days from save
        </p>
      </div>
      <p v-else class="facet-hint">Every live course, no per-course selection.</p>

      <p v-if="error" class="form-error">{{ error }}</p>

      <div class="facet-actions">
        <Button variant="primary" size="sm" :loading="isSaving" :disabled="isSaving" @click="save">
          {{ isSaving ? 'Saving…' : 'Save' }}
        </Button>
      </div>
    </template>
  </FrostCard>
</template>

<style scoped>
.node-entitlement {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.facet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.facet-hint,
.current-summary {
  font-size: var(--text-sm);
  color: var(--ink-secondary, var(--text-secondary));
  margin: 0;
}

.current-summary {
  font-weight: var(--font-semibold);
  color: var(--ink-primary, var(--text-primary));
}

.state-toggle {
  display: inline-flex;
  border: 1px solid var(--glass-border, var(--border-subtle));
  border-radius: var(--radius-lg);
  overflow: hidden;
  width: fit-content;
}

.state-option {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  background: transparent;
  color: var(--ink-secondary, var(--text-secondary));
  border: none;
  cursor: pointer;
  transition: all var(--transition-base);
}

.state-option.is-selected {
  background: rgba(var(--tone-gold), 0.18);
  color: var(--ink-primary, var(--text-primary));
}

.trial-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.course-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  max-height: 220px;
  overflow-y: auto;
}

.course-option {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border, var(--border-subtle));
  background: transparent;
  font-size: var(--text-xs);
  cursor: pointer;
  color: var(--ink-secondary, var(--text-secondary));
  transition: all var(--transition-base);
}

.course-option.is-selected {
  background: rgba(var(--tone-gold), 0.18);
  border-color: rgba(var(--tone-gold), 0.4);
  color: var(--ink-primary, var(--text-primary));
}

.expiry-preview {
  font-size: var(--text-xs);
  color: var(--ink-muted, var(--text-muted));
  margin: 0;
}

.form-error {
  font-size: var(--text-sm);
  color: var(--error, var(--ssi-red));
  margin: 0;
}

.facet-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
