<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ContributionData } from '@/composables/useContribution'

const props = defineProps<{
  data: ContributionData
  localPhrases: number
}>()

const emit = defineEmits<{
  close: []
}>()

const activeTab = ref<'today' | 'days7' | 'days30' | 'allTime'>('today')

const tabs = [
  { key: 'today' as const, label: 'Today' },
  { key: 'days7' as const, label: '7 days' },
  { key: 'days30' as const, label: '30 days' },
  { key: 'allTime' as const, label: 'All time' },
]

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

const globalMinutes = computed(() => {
  const tf = props.data.global[activeTab.value]
  const base = tf.minutes
  return activeTab.value === 'today' ? base + Math.round(props.localPhrases * 0.18) : base
})

const globalPhrases = computed(() => {
  const tf = props.data.global[activeTab.value]
  return activeTab.value === 'today' ? tf.phrases + props.localPhrases : tf.phrases
})

const speakers = computed(() => {
  if (activeTab.value === 'today') return props.data.global.today.speakers
  if (activeTab.value === 'days7') return props.data.global.days7.speakers
  return 0 // 30d and all-time speaker counts aren't meaningful aggregates
})

const userMinutes = computed(() => {
  const tf = props.data.user[activeTab.value]
  const base = tf.minutes
  return activeTab.value === 'today' ? base + Math.round(props.localPhrases * 0.18) : base
})

const userPhrases = computed(() => {
  const tf = props.data.user[activeTab.value]
  return activeTab.value === 'today' ? tf.phrases + props.localPhrases : tf.phrases
})

const contextMessage = computed(() => {
  const lang = props.data.languageName
  const mins = formatNumber(globalMinutes.value)
  const sp = speakers.value

  switch (activeTab.value) {
    case 'today':
      if (sp > 1) return `Your ${userMinutes.value} mins joined ${sp} other speakers today keeping ${lang} alive.`
      if (userMinutes.value > 0) return `You kept ${lang} alive today.`
      return `${lang} needs your voice today.`
    case 'days7':
      return `You and ${sp > 0 ? sp.toLocaleString() + ' others' : 'other learners'} spoke ${mins} minutes of ${lang} this week.`
    case 'days30':
      return `${mins} minutes of ${lang} spoken this month by SSi learners worldwide.`
    case 'allTime':
      return `${mins} minutes of ${lang}. You contributed ${formatNumber(userMinutes.value)} of them.`
  }
})
</script>

<template>
  <Transition name="contribution-expand">
    <div class="contribution-overlay" @click.self="emit('close')">
      <div class="contribution-panel">
        <button class="close-btn" @click="emit('close')" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <h2 class="panel-title">{{ data.languageName }} Spoken</h2>

        <!-- Timeframe tabs -->
        <div class="tab-bar">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-btn"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- Global total -->
        <div class="global-total">
          <span class="total-number">{{ formatNumber(globalMinutes) }}</span>
          <span class="total-label">minutes</span>
        </div>

        <!-- Context message -->
        <p class="context-message">{{ contextMessage }}</p>

        <!-- Your contribution -->
        <div class="user-contribution" v-if="userMinutes > 0 || userPhrases > 0">
          <div class="user-stat">
            <span class="user-value">+{{ formatNumber(userMinutes) }}</span>
            <span class="user-label">your mins</span>
          </div>
          <div class="user-stat">
            <span class="user-value">+{{ formatNumber(userPhrases) }}</span>
            <span class="user-label">your phrases</span>
          </div>
        </div>

        <p class="philosophy-quote">Every phrase keeps {{ data.languageName }} alive</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.contribution-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.contribution-panel {
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1.5px solid rgba(0, 0, 0, 0.12);
  border-radius: 20px;
  padding: 1.75rem;
  max-width: 380px;
  width: 100%;
  position: relative;
  text-align: center;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: #A09A94;
  cursor: pointer;
  padding: 4px;
}
.close-btn:hover { color: #2C2622; }

.panel-title {
  font-size: 0.6875rem;
  font-weight: 600;
  color: #A09A94;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 1rem;
}

.tab-bar {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
  padding: 3px;
  margin-bottom: 1.25rem;
}

.tab-btn {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #A09A94;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: white;
  color: #2C2622;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.tab-btn:hover:not(.active) {
  color: #6B6560;
}

.global-total {
  margin-bottom: 0.75rem;
}

.total-number {
  display: block;
  font-family: 'Space Mono', monospace;
  font-size: 2.5rem;
  font-weight: 700;
  color: #2C2622;
  line-height: 1.1;
}

.total-label {
  display: block;
  font-size: 0.75rem;
  color: #A09A94;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.context-message {
  font-size: 0.8125rem;
  color: #6B6560;
  line-height: 1.5;
  margin-bottom: 1.25rem;
}

.user-contribution {
  display: flex;
  justify-content: center;
  gap: 2rem;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
  margin-bottom: 1rem;
}

.user-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.user-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: #2C2622;
}

.user-label {
  font-size: 0.625rem;
  color: #A09A94;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.philosophy-quote {
  font-size: 0.75rem;
  color: #A09A94;
  font-style: italic;
}

.contribution-expand-enter-active,
.contribution-expand-leave-active {
  transition: opacity 0.25s ease;
}
.contribution-expand-enter-active .contribution-panel,
.contribution-expand-leave-active .contribution-panel {
  transition: transform 0.25s ease;
}
.contribution-expand-enter-from,
.contribution-expand-leave-to {
  opacity: 0;
}
.contribution-expand-enter-from .contribution-panel {
  transform: scale(0.95) translateY(10px);
}
.contribution-expand-leave-to .contribution-panel {
  transform: scale(0.95) translateY(10px);
}
</style>
