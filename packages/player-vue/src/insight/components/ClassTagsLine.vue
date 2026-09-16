<script setup lang="ts">
// ============================================================================
// components/ClassTagsLine.vue — YEAR and DEPARTMENT, shown as what they are.
//
// Tom's ruling, 2026-09-16: tags are OPTIONAL (no tag, no comparison at that
// level, drawn as absence), DERIVABLE (year from the class name, department
// from the course) and CORRECTABLE (shown as a guess a teacher fixes in
// place, never a form filled first). A derived tag reads as derived until
// someone confirms it; only then does a comparison at that level exist —
// otherwise a misread "8A" moves a cohort with no visible cause.
// ============================================================================
import { ref } from 'vue'
import { useI18n } from '@/composables/useI18n'

export interface TagView { value: string | null; confirmed: boolean; derived: string | null }
export interface ClassTagsView { year: TagView; department: TagView }
type Kind = 'year' | 'department'

const props = defineProps<{ tags: ClassTagsView; saving?: boolean; error?: string | null }>()
const emit = defineEmits<{ save: [kind: Kind, value: string | null] }>()
const { t } = useI18n()

const editing = ref<Kind | null>(null)
const draft = ref('')

function label(kind: Kind, v: string): string {
  return kind === 'year'
    ? t('insights.tags.yearValue', 'Year {n}').replace('{n}', v)
    : t('insights.tags.departmentValue', '{name} department').replace('{name}', v)
}
function startEdit(kind: Kind): void {
  editing.value = kind
  draft.value = props.tags[kind].value ?? ''
}
function commit(): void {
  if (!editing.value) return
  const v = draft.value.trim()
  emit('save', editing.value, v || null)
  editing.value = null
}
</script>

<template>
  <!-- HANDBOOK Tell us the year and department
       section: seeing-progress
       moment: setting-up
       roles: teacher, school_admin, leader, admin
       place: node-insights
       keywords: year, department, tag, confirm, guess, compare, year average
       What it's for. Saying which year and which department a class belongs to,
       so it can be compared with the other classes in the same year or the same
       department. Both are guessed for you — the year from the class name, the
       department from the course — and a guess is shown as a guess until you
       confirm it.
       Where it is. The line under the class card on the class's insights page.
       How you do it.
       1. Read the guess. A dotted underline means it has not been confirmed.
       2. Tap **confirm** if it is right, or **change** and type the right one.
       3. Once confirmed, **Compare to** offers that year or department as an
          average, provided another confirmed class shares it.
       Worth knowing. Nothing is required. A class with no year set is simply not
       compared at year level. A guess is never used for a comparison, because a
       misread name would move an average with no visible cause.
       checked: 4b4df8fe.2a6f9e50
  -->
  <div class="ct" data-walk="insights-class-tags">
    <template v-for="kind in (['year', 'department'] as const)" :key="kind">
      <span class="ct-item">
        <template v-if="editing === kind">
          <label class="ct-edit">
            <span class="ct-edit-label">{{ kind === 'year' ? t('insights.tags.year', 'Year') : t('insights.tags.department', 'Department') }}</span>
            <input v-model="draft" class="ct-input" type="text" :aria-label="kind === 'year' ? t('insights.tags.year', 'Year') : t('insights.tags.department', 'Department')" @keyup.enter="commit" @keyup.escape="editing = null" />
            <button type="button" class="ct-btn ct-btn-primary" :disabled="saving" @click="commit">{{ t('insights.tags.save', 'Save') }}</button>
            <button type="button" class="ct-btn" @click="editing = null">{{ t('common.cancel', 'Cancel') }}</button>
          </label>
        </template>
        <template v-else-if="tags[kind].value && tags[kind].confirmed">
          <span class="ct-value ct-confirmed">{{ label(kind, tags[kind].value!) }}</span>
          <button type="button" class="ct-link" @click="startEdit(kind)">{{ t('insights.tags.change', 'change') }}</button>
        </template>
        <template v-else-if="tags[kind].value">
          <span class="ct-value ct-guess">{{ label(kind, tags[kind].value!) }}</span>
          <span class="ct-hint">{{ kind === 'year' ? t('insights.tags.guessedFromName', 'guessed from the name') : t('insights.tags.guessedFromCourse', 'guessed from the course') }}</span>
          <button type="button" class="ct-link ct-link-confirm" :disabled="saving" @click="emit('save', kind, tags[kind].value)">{{ t('insights.tags.confirm', 'confirm') }}</button>
          <button type="button" class="ct-link" @click="startEdit(kind)">{{ t('insights.tags.change', 'change') }}</button>
        </template>
        <template v-else>
          <span class="ct-hint">{{ kind === 'year' ? t('insights.tags.noYear', 'No year set') : t('insights.tags.noDepartment', 'No department set') }}</span>
          <button type="button" class="ct-link" @click="startEdit(kind)">{{ t('insights.tags.add', 'add') }}</button>
        </template>
      </span>
    </template>
    <span v-if="error" class="ct-error">{{ error }}</span>
  </div>
</template>

<style scoped>
.ct {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--ink-muted, #8A8078);
}
.ct-item { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ct-value { color: var(--ink-primary, #2C2622); }
.ct-guess { border-bottom: 1px dashed rgba(44, 38, 34, 0.35); }
.ct-confirmed::after { content: ' ✓'; color: rgba(var(--rc-positive, 21, 128, 61), 0.9); }
.ct-hint { color: var(--ink-muted, #8A8078); }
.ct-link {
  font: inherit;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: rgba(var(--rc-entity-ink, 37, 99, 235), 1);
  text-decoration: underline dotted;
}
.ct-link:disabled { opacity: 0.5; cursor: default; }
.ct-edit { display: inline-flex; align-items: center; gap: 6px; }
.ct-edit-label { color: var(--ink-muted, #8A8078); }
.ct-input {
  font: inherit;
  width: 9ch;
  padding: 3px 6px;
  border: 1px solid rgba(44, 38, 34, 0.2);
  border-radius: 6px;
  background: #fff;
  color: var(--ink-primary, #2C2622);
}
.ct-btn {
  font: inherit;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(44, 38, 34, 0.15);
  background: #fff;
  color: var(--ink-primary, #2C2622);
  cursor: pointer;
}
.ct-btn-primary { background: rgba(var(--rc-entity, 96, 165, 250), 0.18); }
.ct-error { color: #b42318; }
</style>
