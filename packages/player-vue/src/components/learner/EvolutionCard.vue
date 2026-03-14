<script setup lang="ts">
interface Props {
  score: number
  level: number
  name: string
  icon: string
  nextThreshold: number
  progress: number
}

const props = defineProps<Props>()
</script>

<template>
  <div class="evolution-card">
    <div class="evolution-icon">{{ icon }}</div>
    <div class="evolution-name">{{ name }}</div>
    <div class="evolution-score">{{ score.toLocaleString() }}</div>
    <div class="evolution-progress-track">
      <div
        class="evolution-progress-fill"
        :style="{ width: `${progress}%` }"
      ></div>
    </div>
    <div class="evolution-level-badge">Level {{ level }}</div>
  </div>
</template>

<style scoped>
.evolution-card {
  background: var(--bg-card, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: 16px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
}

.evolution-icon {
  font-size: 2.5rem;
  line-height: 1;
  filter: drop-shadow(0 0 12px var(--accent-glow, rgba(255, 255, 255, 0.2)));
}

.evolution-name {
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary, #fff);
  letter-spacing: -0.01em;
}

.evolution-score {
  font-family: 'Space Mono', monospace;
  font-size: 2rem;
  font-weight: 700;
  color: var(--accent, #60a5fa);
  line-height: 1;
  text-shadow: 0 0 30px var(--accent-glow, rgba(96, 165, 250, 0.3));
}

.evolution-progress-track {
  width: 100%;
  height: 6px;
  background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
  border-radius: 3px;
  overflow: hidden;
  margin-top: 0.25rem;
}

.evolution-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--accent-dark, #2563eb), var(--accent, #60a5fa));
  box-shadow: 0 0 12px var(--accent-glow, rgba(96, 165, 250, 0.3));
  transition: width 0.5s ease-out;
}

.evolution-level-badge {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 0.25rem;
}
</style>
