<script setup lang="ts">
import { computed } from 'vue'

interface MilestoneItem {
  milestone_type: string
  achieved_at: string
  display_text: string
  display_icon: string
}

interface Props {
  milestones: MilestoneItem[]
}

const props = defineProps<Props>()

function formatDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 14) return '1 week ago'
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const sortedMilestones = computed(() =>
  [...props.milestones].sort((a, b) =>
    new Date(b.achieved_at).getTime() - new Date(a.achieved_at).getTime()
  )
)
</script>

<template>
  <div class="timeline-card">
    <h3 class="timeline-title">Your Journey</h3>

    <div v-if="sortedMilestones.length === 0" class="timeline-empty">
      Your journey is just beginning...
    </div>

    <div v-else class="timeline-list">
      <div
        v-for="(m, i) in sortedMilestones"
        :key="i"
        class="timeline-item"
      >
        <div class="timeline-line-segment">
          <div class="timeline-dot"></div>
          <div v-if="i < sortedMilestones.length - 1" class="timeline-connector"></div>
        </div>
        <div class="timeline-content">
          <span class="timeline-icon">{{ m.display_icon }}</span>
          <div class="timeline-text-group">
            <span class="timeline-text">{{ m.display_text }}</span>
            <span class="timeline-date">{{ formatDate(m.achieved_at) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-card {
  background: var(--bg-card, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: 16px;
  padding: 1.25rem;
  max-height: 280px;
  overflow-y: auto;
}

.timeline-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #fff);
  margin: 0 0 1rem 0;
}

.timeline-empty {
  font-size: 0.875rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  font-style: italic;
  text-align: center;
  padding: 1rem 0;
}

.timeline-list {
  display: flex;
  flex-direction: column;
}

.timeline-item {
  display: flex;
  gap: 0.75rem;
  min-height: 48px;
}

.timeline-line-segment {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 12px;
  flex-shrink: 0;
}

.timeline-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent, #60a5fa);
  box-shadow: 0 0 8px var(--accent-glow, rgba(96, 165, 250, 0.3));
  flex-shrink: 0;
  margin-top: 6px;
}

.timeline-connector {
  width: 2px;
  flex: 1;
  background: var(--border-subtle, rgba(255, 255, 255, 0.08));
  margin: 4px 0;
}

.timeline-content {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding-bottom: 0.75rem;
  flex: 1;
}

.timeline-icon {
  font-size: 1.125rem;
  line-height: 1;
  flex-shrink: 0;
}

.timeline-text-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeline-text {
  font-size: 0.8125rem;
  color: var(--text-primary, #fff);
  line-height: 1.3;
}

.timeline-date {
  font-size: 0.6875rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
}
</style>
