<script setup lang="ts">
// ============================================================================
// boards/VadBoard.vue — Lens (attention · voice) · Voice & pause
//
// The FIRST class/school-level read of the VAD / prosody telemetry. Until this
// board, the only surface showing it was the per-learner admin page ("Adaptive
// pause mastery"), one learner at a time — so there was no way to look at a
// class and ask "is this working, and for how many of them?"
//
// THE HONESTY REQUIREMENT (the whole point of the board):
//   Roughly half the learners carry NO row at all in the VAD-fed tables — not
//   zeros, nothing. Not everyone ends up with their own account and a working
//   mic. That is UPTAKE, and uptake is part of the insight, not missing data.
//   So the first thing on the board is the fraction, and every aggregate below
//   states the denominator it was actually taken over.
//
// DIRECT READ, deliberately: see data/vadUptake.ts — the analytics_* rollups
// exclude demo learners by policy, so an aggregate built on them shows nothing.
// This board reads learner_lego_metrics and player_events directly, the way the
// per-learner admin page does. The exclusion policy is untouched.
//
// PROSODY COMES FROM THE SERVER, everything else from the browser: player_events
// is own-row under RLS for admins too, so a client read of another learner's
// cycle_prosody returns nothing. GET /api/admin/vad-prosody is the
// server-mediated door. If it fails, the panel SAYS it failed.
//
// THE ADMIN DOOR, not the only one, since the founder ruling of 2026-08-20
// ("VAD follows the same hierarchy of visibility that all data follows").
// Group leaders, school leaders and teachers reach the SAME renderer scoped to
// their own subtree, via GET /api/org/vad on the node insights surface. What
// stays admin-only here is the WHOLE-FOREST roster and its school picker —
// this board reads every school there is, which is an admin's question.
// ============================================================================
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import VadPanel from '../VadPanel.vue'
import {
  fetchVadRoster,
  summariseVad,
  type SchoolScope,
  type VadRosterPayload,
  type VadSummary,
} from '../data/vadUptake'

const { getClient, getAuthToken } = useAdminClient()
const router = useRouter()

const isLoading = ref(true)
const fetchError = ref<string | null>(null)
const roster = ref<VadRosterPayload | null>(null)
const selectedSchoolId = ref<string | null>(null)
const selectedClassId = ref<string | null>(null)   // null = whole school

// ---- load ------------------------------------------------------------------
onMounted(async () => {
  try {
    const payload = await fetchVadRoster(getClient(), await getAuthToken())
    roster.value = payload
    // Open on the school with the MOST learners carrying VAD data, so the board
    // lands populated rather than on whichever school sorts first. Flagged as a
    // taste default — the picker moves it in one click.
    let best: SchoolScope | null = null
    let bestCount = -1
    for (const s of payload.scopes) {
      const n = s.learnerIds.filter(id => payload.metricsByLearner.has(id)).length
      if (n > bestCount) { bestCount = n; best = s }
    }
    selectedSchoolId.value = best?.schoolId ?? null
  } catch (e: unknown) {
    fetchError.value = e instanceof Error ? e.message : 'Failed to load VAD telemetry'
    console.error('[VadBoard]', e)
  } finally {
    isLoading.value = false
  }
})

// ---- scope -----------------------------------------------------------------
const schools = computed<SchoolScope[]>(() => roster.value?.scopes ?? [])
const school = computed<SchoolScope | null>(
  () => schools.value.find(s => s.schoolId === selectedSchoolId.value) ?? null,
)
const scopeLearnerIds = computed<string[]>(() => {
  if (!school.value) return []
  if (!selectedClassId.value) return school.value.learnerIds
  return school.value.classes.find(c => c.classId === selectedClassId.value)?.learnerIds ?? []
})
const scopeLabel = computed(() => {
  if (!school.value) return '—'
  if (!selectedClassId.value) return school.value.schoolName
  const cls = school.value.classes.find(c => c.classId === selectedClassId.value)
  return cls ? `${cls.className} · ${school.value.schoolName}` : school.value.schoolName
})

function selectSchool(id: string) {
  selectedSchoolId.value = id
  selectedClassId.value = null
}

// ---- summary ---------------------------------------------------------------
const summary = computed<VadSummary | null>(() => {
  const r = roster.value
  if (!r) return null
  return summariseVad(scopeLearnerIds.value, r.names, r.metricsByLearner, r.prosodyByLearner)
})

// ---- render ----------------------------------------------------------------
// Every widget, the uptake tile and the honesty copy live in VadPanel — the ONE
// renderer, shared with the hierarchy-scoped node surfaces (founder ruling
// 2026-08-20). This board is now just the admin door in front of it: the
// whole-forest roster read plus the school/class pickers that only an admin
// has anything to pick from.
function openLearner(learnerId: string) {
  router.push(`/admin/users/${learnerId}`)
}
</script>

<template>
  <section class="vad">
    <!-- ---- Board header ------------------------------------------------- -->
    <header class="vad-head">
      <div class="vad-title-block">
        <span class="vad-lens-kicker">Attention · voice</span>
        <h2 class="vad-title">Voice &amp; pause</h2>
        <p class="vad-sub">
          What the microphone is actually giving us — how many learners have
          mic-derived data at all, and for those who do, how the adaptive pause
          is settling and how they sound.
        </p>
      </div>

      <div v-if="schools.length" class="vad-picker">
        <label class="vad-picker-label" for="vad-school">School</label>
        <select
          id="vad-school"
          class="vad-select"
          :value="selectedSchoolId ?? ''"
          @change="selectSchool(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in schools" :key="s.schoolId" :value="s.schoolId">{{ s.schoolName }}</option>
        </select>
      </div>
    </header>

    <!-- ---- Scope: whole school or one class ---------------------------- -->
    <nav v-if="school" class="vad-scopes" aria-label="Scope">
      <button
        type="button"
        :class="['vad-chip', { active: selectedClassId === null }]"
        @click="selectedClassId = null"
      >Whole school</button>
      <button
        v-for="c in school.classes"
        :key="c.classId"
        type="button"
        :class="['vad-chip', { active: selectedClassId === c.classId }]"
        @click="selectedClassId = c.classId"
      >{{ c.className }}</button>
    </nav>

    <VadPanel
      :summary="summary"
      :scope-label="scopeLabel"
      :is-loading="isLoading"
      :error="fetchError"
      :classes="selectedClassId ? [] : (school?.classes ?? [])"
      :names="roster?.names"
      :metrics-by-learner="roster?.metricsByLearner"
      :prosody-by-learner="roster?.prosodyByLearner"
      @open-learner="openLearner"
    />
  </section>
</template>

<style scoped>
.vad {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1280px;
  margin: 0 auto;
}

/* ---- Header ------------------------------------------------------------- */
.vad-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}
.vad-title-block { display: flex; flex-direction: column; gap: 4px; }
.vad-lens-kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(var(--tone-red), 1);
}
.vad-title {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  margin: 0;
}
.vad-sub {
  font-size: 13.5px;
  color: var(--ink-muted);
  margin: 0;
  max-width: 44rem;
}

/* ---- School picker ------------------------------------------------------ */
.vad-picker { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.vad-picker-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.vad-select {
  appearance: none;
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 10px;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--ink-primary);
  cursor: pointer;
}

/* ---- Scope chips -------------------------------------------------------- */
.vad-scopes { display: flex; flex-wrap: wrap; gap: 8px; }
.vad-chip {
  appearance: none;
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.15);
  border-radius: 999px;
  padding: 6px 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-secondary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.vad-chip:hover:not(.active) { color: var(--ink-primary); }
.vad-chip.active {
  background: rgba(var(--tone-red), 0.10);
  color: rgba(var(--tone-red), 1);
  border-color: rgba(var(--tone-red), 0.3);
}

/* ---- Responsive --------------------------------------------------------- */
@media (max-width: 860px) {
  .vad-head { flex-direction: column; align-items: flex-start; }
}
</style>
