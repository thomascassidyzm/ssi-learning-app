<script setup lang="ts">
// ============================================================================
// YourInsights — the Library's "Your insights" section (job #634).
//
// Tom, 2026-09-14: "the library insights tool can be built, all the pieces are
// there already" — a learner sees how they are doing, at a granular level,
// against the COURSE AVERAGE, and "never against other individuals of course".
//
// So this is the thinnest possible door onto the one insight engine: a card in
// the Library, and beneath it, when opened, NodeRateEngine pointed at
// /api/me/insights — the same widget, pickers and chips the Intelligence page
// and every school surface draw. The entity is the learner; the comparator is
// the course average (learner-weighted, job #621's definition) or the average
// of all courses; the measures are in-app minutes, minutes per session and
// Listening Mode minutes; the windows are today / 7 days / 30 days.
//
// What is NOT here, by ruling: no other named person, no ranking, and a
// percentile only when the course has enough active people that it cannot be
// read back to anyone — the server decides that and sends a note instead of a
// shape when it cannot; the widget renders the note.
//
// Guests are offered sign-in: insights are about a learner's own diary, and a
// guest has none the server can name.
// ============================================================================
import { ref, computed, inject, type Ref } from 'vue'
import NodeRateEngine from '@/insight/NodeRateEngine.vue'
import { useI18n } from '@/composables/useI18n'
import '@/styles/schools-tokens.css'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  courseCode?: string | null
  isGuest?: boolean
}>(), { courseCode: null, isGuest: false })

const emit = defineEmits<{ signIn: [] }>()

const supabaseClient = inject<Ref<any> | null>('supabase', null)

async function getToken(): Promise<string | null> {
  const sb = supabaseClient?.value
  if (!sb) return null
  try {
    const { data: { session } } = await sb.auth.getSession()
    return session?.access_token ?? null
  } catch {
    return null
  }
}

const open = ref(false)

// The engine's four v-models. The course starts as the learner's active
// course; the server resolves every other default and reflects it back.
const course = ref<string | null>(props.courseCode ?? null)
const compare = ref<string | null>(null)
const window_ = ref<string | null>(null)
const measure = ref<string | null>(null)

const cardTitle = computed(() =>
  props.isGuest ? t('insights.you.guestTitle', 'Sign in to see your insights') : t('insights.you.cardTitle', 'How your practice is going'))
const cardLine = computed(() =>
  props.isGuest
    ? t('insights.you.guestLine', 'Your minutes against the course average, once you have an account.')
    : t('insights.you.cardLine', 'Your minutes against the course average — never against another person.'))

function tap(): void {
  if (props.isGuest) { emit('signIn'); return }
  open.value = !open.value
}
</script>

<template>
  <section class="section yi" data-testid="your-insights">
    <h3 class="section-label">{{ t('insights.you.sectionLabel', 'Your insights') }}</h3>
    <button type="button" class="yi-card" :class="{ 'is-open': open }" data-testid="your-insights-card" @click="tap">
      <span class="yi-card-title">{{ cardTitle }}</span>
      <span class="yi-card-line">{{ cardLine }}</span>
      <span v-if="!isGuest" class="yi-card-action">{{ open ? t('insights.you.close', 'Close') : t('insights.you.open', 'Take a look') }}</span>
    </button>

    <transition name="yi-fade">
      <div v-if="open && !isGuest" class="yi-panel schools-surface" data-testid="your-insights-panel">
        <p class="yi-intro">{{ t('insights.you.intro', 'This is your own journey against the typical person on your course. Nobody else’s numbers are shown here, and nobody sees yours.') }}</p>
        <NodeRateEngine
          node-id="me"
          endpoint="/api/me/insights"
          v-model:course="course"
          v-model:compare="compare"
          v-model:window="window_"
          v-model:measure="measure"
          :get-token="getToken"
        />
      </div>
    </transition>
  </section>
</template>

<style scoped>
.section { margin-bottom: 1.5rem; }
.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0.25rem;
}
.yi-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  padding: 1rem 1.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  font: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}
.yi-card:hover { background: var(--bg-elevated); border-color: var(--border-medium); }
.yi-card:active { transform: scale(0.99); }
.yi-card-title { font-size: 0.95rem; font-weight: 600; color: var(--text-primary); }
.yi-card-line { font-size: 0.8rem; line-height: 1.45; color: var(--text-muted); }
.yi-card-action {
  margin-top: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent-belt, #7C6A58);
}
.yi-panel {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.yi-intro {
  margin: 0 0.25rem;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-muted);
}
.yi-fade-enter-active, .yi-fade-leave-active { transition: opacity 0.18s ease; }
.yi-fade-enter-from, .yi-fade-leave-to { opacity: 0; }
</style>
