<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

type BenchData = { class: number; school: number; course: number }

const props = defineProps<{
  data: BenchData
  unit?: string
}>()

const max = computed(() => {
  const m = Math.max(props.data.class, props.data.school, props.data.course)
  return m > 0 ? m * 1.1 : 1
})

const rows = computed(() => [
  { label: t('schools.ui.bench.labelClass', 'Class'),  value: props.data.class,  color: 'var(--schools-red)' },
  { label: t('schools.ui.bench.labelSchool', 'School'), value: props.data.school, color: 'rgba(15,18,18,.35)' },
  { label: t('schools.ui.bench.labelGlobal', 'Global'), value: props.data.course, color: 'rgba(15,18,18,.18)' },
])

const unit = computed(() => props.unit ?? 'm')
</script>

<template>
  <div class="bench">
    <div v-for="row in rows" :key="row.label" class="bench-row">
      <span class="bench-label">{{ row.label }}</span>
      <div class="bench-track">
        <div
          class="bench-fill"
          :style="{ width: `${(row.value / max) * 100}%`, background: row.color }"
        />
      </div>
      <span class="bench-value">{{ row.value }}{{ unit }}</span>
    </div>
  </div>
</template>

<style scoped>
.bench-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--schools-fg-2);
  margin-bottom: 3px;
}
.bench-row:last-child { margin-bottom: 0; }
.bench-label { width: 42px; }
.bench-track {
  flex: 1;
  height: 5px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 2.5px;
  overflow: hidden;
}
.bench-fill { height: 100%; }
.bench-value {
  width: 36px;
  text-align: right;
  color: var(--schools-fg);
}
</style>
