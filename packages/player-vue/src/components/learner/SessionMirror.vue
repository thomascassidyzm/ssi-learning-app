<script setup lang="ts">
interface Props {
  pointsEarned: number
  newPhrases: number
  responseTimeDelta?: number
  sessionDuration: number
}

const props = defineProps<Props>()
</script>

<template>
  <div class="session-mirror">
    <div class="mirror-header">This Session</div>
    <div class="mirror-stats">
      <div class="mirror-stat">
        <span class="mirror-stat-value mirror-stat-value--points">+{{ pointsEarned }}</span>
        <span class="mirror-stat-label">Points earned</span>
      </div>
      <div class="mirror-stat">
        <span class="mirror-stat-value">{{ newPhrases }}</span>
        <span class="mirror-stat-label">New phrases</span>
      </div>
      <div class="mirror-stat">
        <span
          class="mirror-stat-value"
          :class="{
            'mirror-stat-value--up': responseTimeDelta && responseTimeDelta > 0,
          }"
        >
          <template v-if="responseTimeDelta && responseTimeDelta > 0">
            {{ responseTimeDelta }}% faster
          </template>
          <template v-else>
            steady
          </template>
        </span>
        <span class="mirror-stat-label">Response time</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-mirror {
  background: var(--bg-card, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: 16px;
  padding: 1.25rem;
}

.mirror-header {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.75rem;
}

.mirror-stats {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.mirror-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  text-align: center;
}

.mirror-stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.mirror-stat-value--points {
  color: var(--accent, #60a5fa);
}

.mirror-stat-value--up {
  color: #4ade80;
}

.mirror-stat-label {
  font-size: 0.625rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 2px;
}
</style>
