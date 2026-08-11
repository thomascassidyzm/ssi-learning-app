<script setup lang="ts">
// Multi-select course picker — extracted verbatim from AdminAccess.vue's
// direct-mode and grant-mode course pickers (identical markup, duplicated
// twice there). One component, used by IndividualAccessForm + EmailAllowlistForm.
import { ref, computed } from 'vue'

interface CourseOption {
  course_code: string
  display_name: string | null
  known_lang: string
  target_lang: string
}

const props = defineProps<{
  courses: CourseOption[]
  modelValue: Set<string>
}>()

const emit = defineEmits<{ 'update:modelValue': [Set<string>] }>()

const search = ref('')
const pickerOpen = ref(false)

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return props.courses
  return props.courses.filter(c =>
    c.course_code.toLowerCase().includes(q) ||
    (c.display_name || '').toLowerCase().includes(q) ||
    c.known_lang.toLowerCase().includes(q) ||
    c.target_lang.toLowerCase().includes(q)
  )
})

function toggle(code: string): void {
  const s = new Set(props.modelValue)
  if (s.has(code)) s.delete(code)
  else s.add(code)
  emit('update:modelValue', s)
}

function courseLabel(c: CourseOption): string {
  return c.display_name || `${c.target_lang} for ${c.known_lang}`
}
</script>

<template>
  <div class="course-picker">
    <div v-if="modelValue.size > 0" class="selected-tags">
      <span
        v-for="code in modelValue"
        :key="code"
        class="course-tag"
        @click="toggle(code)"
      >
        {{ code }}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </span>
    </div>
    <input
      v-model="search"
      type="text"
      class="frost-input"
      placeholder="Search courses…"
      @focus="pickerOpen = true"
    />
    <div v-if="pickerOpen" class="course-dropdown">
      <div class="course-dropdown-list">
        <div
          v-for="c in filtered"
          :key="c.course_code"
          class="course-option"
          :class="{ 'is-selected': modelValue.has(c.course_code) }"
          @click="toggle(c.course_code)"
        >
          <div class="course-option-check">
            <svg v-if="modelValue.has(c.course_code)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div class="course-option-info">
            <span class="course-option-name">{{ courseLabel(c) }}</span>
            <span class="course-option-code">{{ c.course_code }}</span>
          </div>
        </div>
        <div v-if="filtered.length === 0" class="course-option-empty">
          No courses match "{{ search }}"
        </div>
      </div>
      <button
        type="button"
        class="picker-done-btn"
        @click="pickerOpen = false; search = ''"
      >Done</button>
    </div>
  </div>
</template>

<style scoped>
.course-picker {
  position: relative;
}

.selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.course-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(var(--tone-blue), 0.12);
  border: 1px solid rgba(var(--tone-blue), 0.30);
  color: rgb(var(--tone-blue-ink));
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.course-tag:hover {
  background: rgba(var(--tone-red), 0.10);
  border-color: rgba(var(--tone-red), 0.30);
  color: rgb(var(--tone-red));
}

.frost-input {
  font: inherit;
  font-size: var(--text-base);
  padding: 10px 14px;
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  width: 100%;
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder { color: var(--schools-fg-3); }

.frost-input:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}

.course-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: rgba(252, 248, 242, 0.97);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 32px rgba(44, 38, 34, 0.16);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 50;
  max-height: 320px;
  display: flex;
  flex-direction: column;
}

.course-dropdown-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.course-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.course-option:hover { background: rgba(44, 38, 34, 0.04); }

.course-option.is-selected {
  background: rgba(var(--tone-blue), 0.08);
}

.course-option-check {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid rgba(44, 38, 34, 0.20);
  color: rgb(var(--tone-blue-ink));
}

.course-option.is-selected .course-option-check {
  background: rgba(var(--tone-blue), 0.16);
  border-color: rgba(var(--tone-blue), 0.45);
}

.course-option-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.course-option-name {
  color: var(--schools-fg);
  font-size: var(--text-sm);
}

.course-option-code {
  color: var(--schools-fg-3);
  font-family: var(--font-mono);
  font-size: 11px;
}

.course-option-empty {
  padding: 16px;
  text-align: center;
  color: var(--schools-fg-3);
  font-size: var(--text-sm);
}

.picker-done-btn {
  margin: 6px;
  padding: 8px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  background: rgba(44, 38, 34, 0.06);
  border: 1px solid rgba(44, 38, 34, 0.10);
  color: var(--schools-fg);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.picker-done-btn:hover { background: rgba(44, 38, 34, 0.10); }
</style>
