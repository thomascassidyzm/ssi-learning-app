<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ContributionData } from '@/composables/useContribution'
import { t } from '@/composables/useI18n'

const props = defineProps<{
  data: ContributionData
}>()

const emit = defineEmits<{
  close: []
}>()

const activeTab = ref<'today' | 'days7' | 'days30' | 'allTime'>('today')

const tabs = computed(() => [
  { key: 'today' as const, label: t('contribution.today', 'Today') },
  { key: 'days7' as const, label: t('contribution.7days', '7 days') },
  { key: 'days30' as const, label: t('contribution.30days', '30 days') },
  { key: 'allTime' as const, label: t('contribution.allTime', 'All time') },
])

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

const globalMinutes = computed(() => props.data.global[activeTab.value].minutes)
const globalPhrases = computed(() => props.data.global[activeTab.value].phrases)
const speakers = computed(() => props.data.global[activeTab.value].speakers || 0)
const userMinutes = computed(() => props.data.user[activeTab.value].minutes)
const userPhrases = computed(() => props.data.user[activeTab.value].phrases)

const contextMessage = computed(() => {
  const lang = props.data.languageName
  const mins = formatNumber(globalMinutes.value)
  const sp = speakers.value
  const userMins = userMinutes.value

  switch (activeTab.value) {
    case 'today':
      if (userMins > 0 && sp > 1) return t('contribution.joinedToday', 'Your {mins} mins joined {count} other speaker(s) today keeping {language} alive.')
        .replace('{mins}', String(userMins)).replace('{count}', String(sp - 1)).replace('{language}', lang)
      if (userMins > 0) return t('contribution.keptAliveToday', 'You kept {language} alive today.').replace('{language}', lang)
      if (sp > 0) return t('contribution.speakersToday', '{count} speaker(s) kept {language} alive today. Add your voice.')
        .replace('{count}', String(sp)).replace('{language}', lang)
      return t('contribution.needsVoice', '{language} needs your voice today.').replace('{language}', lang)
    case 'days7':
      if (userMins > 0) return t('contribution.contributedWeek', 'You contributed {userMins} of {mins} minutes of {language} this week.')
        .replace('{userMins}', formatNumber(userMins)).replace('{mins}', mins).replace('{language}', lang)
      return t('contribution.weekMinutes', 'SSi learners spoke {mins} minutes of {language} this week.')
        .replace('{mins}', mins).replace('{language}', lang)
    case 'days30':
      if (userMins > 0) return t('contribution.contributedMonth', 'You contributed {userMins} of {mins} minutes of {language} this month.')
        .replace('{userMins}', formatNumber(userMins)).replace('{mins}', mins).replace('{language}', lang)
      return t('contribution.monthMinutes', '{mins} minutes of {language} spoken this month by SSi learners worldwide.')
        .replace('{mins}', mins).replace('{language}', lang)
    case 'allTime':
      if (userMins > 0) return t('contribution.contributedAllTime', '{mins} minutes of {language} on SSi. You contributed {userMins} of them.')
        .replace('{mins}', mins).replace('{language}', lang).replace('{userMins}', formatNumber(userMins))
      return t('contribution.allTimeMinutes', '{mins} minutes of {language} spoken on SSi so far.')
        .replace('{mins}', mins).replace('{language}', lang)
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

        <h2 class="panel-title">
          <span class="panel-title-prefix">Say Something in</span>
          <span class="panel-title-lang">{{ data.languageName }}</span>
        </h2>

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
          <span class="total-label">{{ t('contribution.minutes', 'Minutes') }}</span>
        </div>

        <!-- Context message -->
        <p class="context-message">{{ contextMessage }}</p>

        <!-- Your contribution -->
        <div class="user-contribution" v-if="userMinutes > 0 || userPhrases > 0">
          <div class="user-stat">
            <span class="user-value">+{{ formatNumber(userMinutes) }}</span>
            <span class="user-label">{{ t('contribution.yourMins', 'your mins') }}</span>
          </div>
          <div class="user-stat">
            <span class="user-value">+{{ formatNumber(userPhrases) }}</span>
            <span class="user-label">{{ t('contribution.yourPhrases', 'your phrases') }}</span>
          </div>
        </div>

        <p class="philosophy-quote">{{ t('contribution.everyPhrase', 'Every phrase keeps {language} alive').replace('{language}', data.languageName) }}</p>
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
  align-items: flex-start;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
  padding-top: max(env(safe-area-inset-top, 0px) + 3rem, 10vh);
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
  margin-bottom: 1rem;
  line-height: 1.3;
}

.panel-title-prefix {
  display: block;
  font-size: 0.6875rem;
  font-weight: 400;
  color: #A09A94;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.panel-title-lang {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  color: #c0392b;
  letter-spacing: -0.01em;
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
