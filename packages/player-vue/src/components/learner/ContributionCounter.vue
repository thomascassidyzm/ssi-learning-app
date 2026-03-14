<script setup lang="ts">
interface Props {
  languageName: string
  phrasesCount: number
  minutesPracticed: number
  uniqueSpeakers: number
  userMinutes: number
  userPhrases: number
}

const props = defineProps<Props>()
</script>

<template>
  <div class="contribution-card">
    <div class="contribution-header">{{ languageName }} Spoken Today</div>

    <div class="contribution-stats">
      <div class="contrib-stat">
        <span class="contrib-stat-value">{{ phrasesCount.toLocaleString() }}</span>
        <span class="contrib-stat-label">phrases</span>
      </div>
      <div class="contrib-stat">
        <span class="contrib-stat-value">{{ minutesPracticed.toLocaleString() }}</span>
        <span class="contrib-stat-label">minutes</span>
      </div>
      <div class="contrib-stat">
        <span class="contrib-stat-value">{{ uniqueSpeakers.toLocaleString() }}</span>
        <span class="contrib-stat-label">speakers</span>
      </div>
    </div>

    <div class="contribution-divider"></div>

    <div class="contribution-you">
      You contributed: {{ userMinutes }} mins ({{ userPhrases }} phrases)
    </div>

    <div class="contribution-quote">
      Every phrase keeps {{ languageName }} alive
    </div>
  </div>
</template>

<style scoped>
.contribution-card {
  background: var(--bg-card, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: 16px;
  padding: 1.25rem;
}

.contribution-header {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.75rem;
}

.contribution-stats {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.contrib-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

.contrib-stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.contrib-stat-label {
  font-size: 0.625rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.contribution-divider {
  height: 1px;
  background: var(--border-subtle, rgba(255, 255, 255, 0.08));
  margin: 0.75rem 0;
}

.contribution-you {
  font-size: 0.8125rem;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  text-align: center;
}

.contribution-quote {
  font-size: 0.75rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  text-align: center;
  font-style: italic;
  margin-top: 0.5rem;
}
</style>
