<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminActivity } from '@/composables/admin/useAdminActivity'
import { parseCourseCode, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

const { getClient } = useAdminClient()

const {
  isLoading,
  error,
  liveSessions,
  sessionsToday,
  learnersToday,
  minutesToday,
  topCourseToday,
  sessionsByHour,
  fetchActivity,
  startAutoRefresh,
  stopAutoRefresh,
} = useAdminActivity(getClient())

onMounted(async () => {
  await fetchActivity()
  startAutoRefresh()
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<template>
  <div class="admin-activity">
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Activity</h1>
        <div class="metrics">
          <span class="metric live-metric">
            <span class="live-dot"></span>
            <span class="metric-value frost-mono-nums">{{ liveSessions.length }}</span>
            live now
          </span>
          <template v-if="topCourseToday">
            <span class="metric-sep">·</span>
            <span class="metric">
              top today
              <span class="metric-pill">{{ parseCourseCode(topCourseToday).label }}</span>
            </span>
          </template>
        </div>
      </div>
      <div class="refresh-note">Auto-refresh · 60s</div>
    </header>

    <!-- KPI strip (canon §5.1: stones are rare, but a real-time activity
         dashboard is one of the cases where a metric is the whole point) -->
    <div class="kpi-strip">
      <FrostCard variant="stone" tone="blue">
        <div class="stone-content">
          <span class="stone-label">Sessions today</span>
          <span class="stone-value frost-mono-nums">{{ sessionsToday }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="green">
        <div class="stone-content">
          <span class="stone-label">Learners today</span>
          <span class="stone-value frost-mono-nums">{{ learnersToday }}</span>
        </div>
      </FrostCard>
      <FrostCard variant="stone" tone="gold">
        <div class="stone-content">
          <span class="stone-label">Minutes practised</span>
          <span class="stone-value frost-mono-nums">{{ formatDuration(minutesToday) }}</span>
        </div>
      </FrostCard>
    </div>

    <!-- Live now (only when something's happening) -->
    <FrostCard
      v-if="liveSessions.length > 0"
      variant="panel"
      class="live-panel"
    >
      <div class="panel-head">
        <span class="frost-eyebrow">
          <span class="live-dot"></span>
          Live now · <span class="frost-mono-nums">{{ liveSessions.length }}</span>
        </span>
      </div>
      <ul class="live-list">
        <li
          v-for="session in liveSessions"
          :key="session.id"
          class="live-item"
        >
          <span class="live-name">{{ session.display_name }}</span>
          <Badge variant="default" size="sm" pill>
            {{ parseCourseCode(session.course_id).label }}
          </Badge>
          <span class="live-time frost-mono-nums">{{ timeAgo(session.started_at) }}</span>
        </li>
      </ul>
    </FrostCard>

    <!-- Error -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading activity…</div>

    <!-- Activity timeline -->
    <FrostCard
      v-else-if="sessionsByHour.length > 0"
      variant="panel"
      class="timeline-panel"
    >
      <div class="panel-head">
        <span class="frost-eyebrow">Today by the hour</span>
      </div>
      <div class="timeline">
        <div
          v-for="group in sessionsByHour"
          :key="group.hour"
          class="timeline-group"
        >
          <div class="timeline-hour frost-mono-nums">{{ group.hour }}</div>
          <div class="timeline-items">
            <div
              v-for="session in group.sessions"
              :key="session.id"
              class="timeline-item"
            >
              <span class="item-name">{{ session.display_name }}</span>
              <Badge variant="default" size="sm" pill>
                {{ parseCourseCode(session.course_id).label }}
              </Badge>
              <span v-if="session.duration_seconds" class="item-meta frost-mono-nums">
                {{ formatDuration(session.duration_seconds / 60) }}
              </span>
              <span v-if="session.items_practiced" class="item-meta frost-mono-nums">
                {{ session.items_practiced }} items
              </span>
              <Badge
                v-if="!session.ended_at"
                variant="success"
                size="sm"
                pill
                pulse
              >live</Badge>
            </div>
          </div>
        </div>
      </div>
    </FrostCard>

    <!-- Empty state — canon §5.5 -->
    <FrostCard
      v-else-if="!isLoading"
      variant="tile"
      class="empty"
    >
      <div class="empty-ghost">activity</div>
      <div class="empty-copy">
        <strong>No activity in the last 24 hours</strong>
        <p>Sessions will show up here as learners practise.</p>
      </div>
    </FrostCard>
  </div>
</template>

<style scoped>
.admin-activity {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Page header — canon §5.1 */
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
}

.title-block h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 0 0 var(--space-2);
}

.metrics {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-sm);
  flex-wrap: wrap;
}

.metric {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.metric.live-metric {
  color: var(--ink-secondary);
}

.metric-value {
  color: var(--ink-primary);
  font-weight: var(--font-semibold);
}

.metric-sep {
  color: var(--ink-faint);
}

.metric-pill {
  display: inline-block;
  padding: 2px 10px;
  background: rgba(var(--tone-gold), 0.18);
  border: 1px solid rgba(var(--tone-gold), 0.35);
  border-radius: var(--radius-full);
  color: var(--ink-primary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  letter-spacing: 0.01em;
}

.refresh-note {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
  padding-bottom: 4px;
}

/* KPI strip — three stones */
.kpi-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}

.stone-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: var(--space-5) var(--space-6);
  min-height: 140px;
}

.stone-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.stone-value {
  font-family: var(--font-display);
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.025em;
  color: var(--ink-primary);
  margin-top: var(--space-3);
}

/* Live dot — used in metric chip + live panel header */
.live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--tone-green));
  box-shadow: 0 0 0 3px rgba(var(--tone-green), 0.22);
  animation: livepulse 2s ease-in-out infinite;
  margin-right: 6px;
  vertical-align: 1px;
}

@keyframes livepulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* Panel heads (eyebrow row) */
.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

/* Live panel */
.live-panel {
  padding: 0;
  overflow: hidden;
}

.live-list {
  margin: 0;
  padding: var(--space-3) var(--space-3);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.live-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.45);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  transition: background var(--transition-fast);
}

.live-item:hover {
  background: rgba(255, 255, 255, 0.72);
}

.live-name {
  font-weight: var(--font-medium);
  color: var(--ink-primary);
}

.live-time {
  margin-left: auto;
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

/* Timeline panel */
.timeline-panel {
  padding: 0;
  overflow: hidden;
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
}

.timeline-group {
  display: flex;
  gap: var(--space-4);
}

.timeline-hour {
  width: 56px;
  flex-shrink: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--ink-muted);
  padding-top: var(--space-3);
}

.timeline-items {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  border-left: 2px solid rgba(44, 38, 34, 0.08);
  padding-left: var(--space-4);
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: rgba(255, 255, 255, 0.45);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  transition: background var(--transition-fast);
}

.timeline-item:hover {
  background: rgba(255, 255, 255, 0.72);
}

.item-name {
  font-weight: var(--font-medium);
  color: var(--ink-primary);
}

.item-meta {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

/* Error / loading */
.error-banner {
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.25);
  border-radius: var(--radius-lg);
  color: rgb(var(--tone-red));
  font-size: var(--text-sm);
}

.loading {
  text-align: center;
  padding: var(--space-12);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Empty state — canon §5.5 */
.empty {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-6);
  align-items: center;
  padding: var(--space-10) var(--space-8);
  min-height: 180px;
}

.empty-ghost {
  font-family: var(--font-display);
  font-size: 88px;
  font-weight: var(--font-bold);
  letter-spacing: -0.03em;
  color: var(--ink-faint);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--ink-primary);
  margin-bottom: 4px;
}

.empty-copy p {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

@media (max-width: 1024px) {
  .kpi-strip {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .kpi-strip {
    grid-template-columns: 1fr;
  }
  .timeline-group {
    flex-direction: column;
    gap: var(--space-1);
  }
  .timeline-hour {
    width: auto;
    padding-top: 0;
  }
  .timeline-items {
    border-left: none;
    padding-left: 0;
  }
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
