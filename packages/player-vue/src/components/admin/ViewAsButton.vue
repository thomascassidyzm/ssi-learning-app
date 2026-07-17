<script setup lang="ts">
/**
 * ViewAsButton — the one "View as" affordance (eye icon), reused at every
 * entity level (schools list/detail, groups, teachers/school_admins
 * wherever they appear, learners). Wraps useActAs.actAs() so every entry
 * point gets the same read-only banner + audit log for free
 * (useActAs.ts, api/admin/view-as.ts).
 *
 * `candidates` is usually one persona. When a school/group has more than
 * one admin, pass all of them — clicking opens a quick-pick instead of
 * acting-as directly.
 */
import { ref } from 'vue'
import { useActAs } from '@/composables/useActAs'
import type { ActAsPersona } from '@/composables/useUserRole'

const props = defineProps<{
  candidates: ActAsPersona[]
  /** Shown as the button's title when there are no candidates to view as. */
  emptyTitle?: string
}>()

const { actAs } = useActAs()
const showPicker = ref(false)

function onClick(): void {
  if (props.candidates.length === 0) return
  if (props.candidates.length === 1) {
    void actAs(props.candidates[0])
    return
  }
  showPicker.value = !showPicker.value
}

function pick(persona: ActAsPersona): void {
  showPicker.value = false
  void actAs(persona)
}
</script>

<template>
  <span class="view-as-wrap">
    <button
      type="button"
      class="row-action view-as-btn"
      :class="{ 'is-disabled': candidates.length === 0 }"
      :title="candidates.length === 0 ? (emptyTitle || 'No one to view as yet') : 'View as — see exactly what this account sees, read only'"
      @click="onClick"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
    <div v-if="showPicker" class="view-as-picker">
      <button
        v-for="c in candidates"
        :key="c.key"
        type="button"
        class="view-as-picker-item"
        @click="pick(c)"
      >
        {{ c.name }}
      </button>
    </div>
  </span>
</template>

<style scoped>
.view-as-wrap {
  position: relative;
  display: inline-flex;
}
/* Self-contained baseline so the button looks right even in contexts that
   don't already define `.row-action` (e.g. AdminSchoolsContainer's context
   bar) — matches AdminStructure.vue's row-action look for visual consistency. */
.view-as-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  color: inherit;
  cursor: pointer;
}
.view-as-btn:hover {
  background: rgba(15, 18, 18, 0.06);
  border-color: rgba(15, 18, 18, 0.1);
}
.view-as-btn.is-disabled {
  opacity: 0.35;
  cursor: default;
  pointer-events: none;
}
.view-as-picker {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  margin-top: 4px;
  min-width: 160px;
  background: #fff;
  border: 1px solid rgba(15, 18, 18, 0.12);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.view-as-picker-item {
  font: inherit;
  text-align: left;
  padding: 6px 10px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  color: inherit;
}
.view-as-picker-item:hover {
  background: rgba(15, 18, 18, 0.06);
}
</style>
