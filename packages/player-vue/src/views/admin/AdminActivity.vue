<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAdminActivity } from '@/composables/admin/useAdminActivity'
import { parseCourseCode, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'

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
} = useAdminActivity()

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
    <h2 class="page-title">Activity</h2>

    <!-- Summary cards -->
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-value">{{ sessionsToday }}</div>
        <div class="stat-label">Sessions Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ learnersToday }}</div>
        <div class="stat-label">Learners Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ formatDuration(minutesToday) }}</div>
        <div class="stat-label">Minutes Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-value-sm">{{ topCourseToday ? parseCourseCode(topCourseToday).label : '—' }}</div>
        <div class="stat-label">Top Course</div>
      </div>
    </div>

    <!-- Live Now -->
    <div v-if="liveSessions.length > 0" class="live-section">
      <h3 class="section-title">
        <span class="live-dot"></span>
        Live Now ({{ liveSessions.length }})
      </h3>
      <div class="live-list">
        <div v-for="session in liveSessions" :key="session.id" class="live-item">
          <span class="live-name">{{ session.display_name }}</span>
          <Badge variant="default" size="sm" pill>{{ parseCourseCode(session.course_id).label }}</Badge>
          <span class="live-time">{{ timeAgo(session.started_at) }}</span>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading activity...</div>

    <!-- Activity timeline -->
    <div v-else-if="sessionsByHour.length > 0" class="timeline">
      <h3 class="section-title">Today's Activity</h3>
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

    <div v-else-if="!isLoading" class="empty-state">No activity in the last 24 hours.</div>

    <div class="refresh-note">Auto-refreshes every 60s</div>
  </div>
</template>

<style scoped>
.admin-activity {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #e8e8f0);
}

/* Stat cards */
.stat-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary, #e8e8f0);
  line-height: 1;
}

.stat-value-sm {
  font-size: 1.25rem;
}

.stat-label {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a0a0b8);
  margin-top: 8px;
}

/* Section titles */
.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary, #e8e8f0);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Live section */
.live-section {
  background: rgba(74, 222, 128, 0.05);
  border: 1px solid rgba(74, 222, 128, 0.15);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.live-dot {
  width: 8px;
  height: 8px;
  background: #4ade80;
  border-radius: 50%;
  display: inline-block;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.live-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.live-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  font-size: 0.875rem;
}

.live-name {
  font-weight: 500;
  color: var(--text-primary, #e8e8f0);
}

.live-time {
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.75rem;
  margin-left: auto;
}

/* Timeline */
.timeline {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.timeline-group {
  display: flex;
  gap: 16px;
}

.timeline-hour {
  width: 48px;
  flex-shrink: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary, #a0a0b8);
  padding-top: 8px;
}

.timeline-items {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 2px solid rgba(255, 255, 255, 0.08);
  padding-left: 16px;
}

.timeline-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  font-size: 0.875rem;
}

.item-name {
  font-weight: 500;
  color: var(--text-primary, #e8e8f0);
}

.item-duration,
.item-count {
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.75rem;
}

/* Error */
.error-banner {
  padding: 12px 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #ef4444;
  font-size: 0.875rem;
}

/* Loading */
.loading {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #a0a0b8);
}

/* Empty */
.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.875rem;
}

.refresh-note {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-secondary, #a0a0b8);
  opacity: 0.6;
}

@media (max-width: 768px) {
  .stat-cards {
    grid-template-columns: repeat(2, 1fr);
  }

  .timeline-group {
    flex-direction: column;
    gap: 4px;
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
