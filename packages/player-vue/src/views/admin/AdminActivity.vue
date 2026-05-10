<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminActivity } from '@/composables/admin/useAdminActivity'
import { parseCourseCode, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'
import Card from '@/components/schools/shared/Card.vue'
import StatsCard from '@/components/schools/StatsCard.vue'

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
    <!-- Page Header -->
    <header class="page-header animate-in">
      <div class="page-title">
        <h1>Activity</h1>
        <p class="page-subtitle">Real-time learning activity</p>
      </div>
    </header>

    <!-- Summary Stats -->
    <div class="stats-grid animate-in delay-1">
      <StatsCard
        label="Sessions Today"
        :value="sessionsToday"
        icon="⚡"
        variant="blue"
      />
      <StatsCard
        label="Learners Today"
        :value="learnersToday"
        icon="👥"
        variant="gold"
      />
      <StatsCard
        label="Minutes Today"
        :value="formatDuration(minutesToday)"
        icon="⏱"
        variant="green"
      />
      <StatsCard
        label="Top Course"
        :value="topCourseToday ? parseCourseCode(topCourseToday).label : '—'"
        icon="🏆"
        variant="red"
      />
    </div>

    <!-- Live Now -->
    <section v-if="liveSessions.length > 0" class="live-section animate-in delay-2">
      <Card accent="green">
        <template #header>
          <div class="card-header-content">
            <h3 class="card-title">
              <span class="live-dot"></span>
              Live Now ({{ liveSessions.length }})
            </h3>
          </div>
        </template>
        <div class="live-list">
          <div v-for="session in liveSessions" :key="session.id" class="live-item">
            <span class="live-name">{{ session.display_name }}</span>
            <Badge variant="default" size="sm" pill>{{ parseCourseCode(session.course_id).label }}</Badge>
            <span class="live-time">{{ timeAgo(session.started_at) }}</span>
          </div>
        </div>
      </Card>
    </section>

    <!-- Error -->
    <div v-if="error" class="error-banner animate-in delay-2">{{ error }}</div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading-state animate-in delay-2">
      <p>Loading activity...</p>
    </div>

    <!-- Activity Timeline -->
    <section v-else-if="sessionsByHour.length > 0" class="timeline-section animate-in delay-3">
      <Card title="Today's Activity">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </template>
        <div class="timeline">
          <div v-for="group in sessionsByHour" :key="group.hour" class="timeline-group">
            <div class="timeline-hour">{{ group.hour }}</div>
            <div class="timeline-items">
              <div v-for="session in group.sessions" :key="session.id" class="timeline-item">
                <span class="item-name">{{ session.display_name }}</span>
                <Badge variant="default" size="sm" pill>{{ parseCourseCode(session.course_id).label }}</Badge>
                <span v-if="session.duration_seconds" class="item-duration">
                  {{ formatDuration(session.duration_seconds / 60) }}
                </span>
                <span v-if="session.items_practiced" class="item-count">
                  {{ session.items_practiced }} items
                </span>
                <Badge v-if="!session.ended_at" variant="success" size="sm" pill pulse>live</Badge>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </section>

    <div v-else-if="!isLoading" class="empty-state animate-in delay-3">
      No activity in the last 24 hours.
    </div>

    <div class="refresh-note animate-in delay-4">Auto-refreshes every 60s</div>
  </div>
</template>

<style scoped>
.admin-activity {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  max-width: 1200px;
}

/* Page Header */
.page-header {
  margin-bottom: var(--space-2);
}

.page-title h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  margin: 0 0 var(--space-1) 0;
  color: var(--text-primary);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-6);
}

/* Live Section */
.live-section {
  /* Spacing handled by parent gap */
}

.card-header-content {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
}

.live-dot {
  width: 10px;
  height: 10px;
  background: var(--success);
  border-radius: 50%;
  display: inline-block;
  animation: pulse 2s ease-in-out infinite;
  box-shadow: 0 0 8px var(--success);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.live-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.live-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  transition: background var(--transition-fast);
}

.live-item:hover {
  background: var(--bg-elevated);
}

.live-name {
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

.live-time {
  color: var(--text-muted);
  font-size: var(--text-xs);
  margin-left: auto;
}

/* Error */
.error-banner {
  padding: var(--space-4) var(--space-5);
  background: var(--bg-card);
  border: 1px solid var(--ssi-red);
  border-radius: var(--radius-lg);
  color: var(--ssi-red);
  font-size: var(--text-sm);
}

/* Loading */
.loading-state {
  text-align: center;
  padding: var(--space-12);
  color: var(--text-secondary);
}

/* Timeline */
.timeline-section {
  /* Spacing handled by parent gap */
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.timeline-group {
  display: flex;
  gap: var(--space-4);
}

.timeline-hour {
  width: 52px;
  flex-shrink: 0;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  padding-top: var(--space-3);
}

.timeline-items {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  border-left: 2px solid var(--border-subtle);
  padding-left: var(--space-4);
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  transition: background var(--transition-fast);
}

.timeline-item:hover {
  background: var(--bg-elevated);
}

.item-name {
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

.item-duration,
.item-count {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: var(--space-12);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

/* Refresh Note */
.refresh-note {
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-muted);
  opacity: 0.6;
}

/* Responsive */
@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .stats-grid {
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
}
</style>
