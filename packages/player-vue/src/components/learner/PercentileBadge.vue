<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  percentile: number
  languageName: string
}

const props = defineProps<Props>()

const badgeClass = computed(() => {
  if (props.percentile <= 10) return 'badge--gold'
  if (props.percentile <= 25) return 'badge--blue'
  return 'badge--neutral'
})

const shouldShow = computed(() => props.percentile <= 50)
</script>

<template>
  <div v-if="shouldShow" class="percentile-badge" :class="badgeClass">
    Top {{ percentile }}% of {{ languageName }} learners this week
  </div>
</template>

<style scoped>
.percentile-badge {
  display: inline-block;
  font-size: 0.6875rem;
  font-weight: 600;
  padding: 0.375rem 0.75rem;
  border-radius: 20px;
  letter-spacing: 0.02em;
}

.badge--gold {
  background: rgba(252, 211, 77, 0.15);
  color: #fcd34d;
  border: 1px solid rgba(252, 211, 77, 0.25);
}

.badge--blue {
  background: rgba(96, 165, 250, 0.12);
  color: #93bbfd;
  border: 1px solid rgba(96, 165, 250, 0.2);
}

.badge--neutral {
  background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
}
</style>
