<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name: string
  lines?: string
  date?: string
  dense?: boolean
}>(), {
  dense: false,
})

const dateLabel = computed(() => {
  if (props.date) return props.date
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).replace(',', ' ·')
})
</script>

<template>
  <div :class="['greeting', { dense: props.dense }]">
    <div class="greeting-text">
      <div class="greeting-date">{{ dateLabel }}</div>
      <h1 class="arsenal greeting-name">{{ props.name }}</h1>
      <p v-if="props.lines" class="greeting-lines">{{ props.lines }}</p>
    </div>
    <div class="greeting-action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.greeting {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}
.greeting.dense { margin-bottom: 16px; }

.greeting-text { max-width: 640px; }
.greeting.dense .greeting-text { max-width: 800px; }

.greeting-date {
  font-size: 13px;
  color: var(--schools-fg-2);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 6px;
}
.greeting.dense .greeting-date {
  font-size: 11px;
  margin-bottom: 4px;
}

.greeting-name {
  font-size: 46px;
  line-height: 1.05;
  letter-spacing: -0.01em;
}
.greeting.dense .greeting-name { font-size: 30px; }

.greeting-lines {
  font-size: 16px;
  color: var(--schools-fg-2);
  max-width: 580px;
  line-height: 1.5;
  margin-top: 10px;
}
.greeting.dense .greeting-lines {
  font-size: 13.5px;
  max-width: 800px;
  margin-top: 4px;
}

.greeting-action { flex: none; }
</style>
