<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminUserDetail } from '@/composables/admin/useAdminUserDetail'
import { parseCourseCode, getBeltForSeeds, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'

const route = useRoute()
const router = useRouter()
const {
  profile,
  enrollments,
  sessions,
  subscription,
  isLoading,
  error,
  fetchUserDetail,
  getCourseProgress,
} = useAdminUserDetail()

onMounted(() => {
  const learnerId = route.params.learnerId as string
  if (learnerId) {
    fetchUserDetail(learnerId)
  }
})

function goBack() {
  router.push('/admin/users')
}
</script>

<template>
  <div class="admin-user-detail">
    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <button class="breadcrumb-link" @click="goBack">Users</button>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">{{ profile?.display_name || 'Loading...' }}</span>
    </div>

    <!-- Error -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading user detail...</div>

    <template v-else-if="profile">
      <!-- Profile card -->
      <div class="profile-card">
        <div class="profile-info">
          <h2 class="profile-name">{{ profile.display_name || 'Anonymous' }}</h2>
          <div class="profile-meta">
            <span>Joined {{ new Date(profile.created_at).toLocaleDateString() }}</span>
            <span class="meta-sep">|</span>
            <span class="profile-id">{{ profile.user_id }}</span>
          </div>
        </div>
        <div class="profile-badges">
          <Badge v-if="profile.platform_role === 'ssi_admin'" variant="ssi-red" pill>Admin</Badge>
          <Badge v-if="profile.educational_role === 'god'" variant="ssi-gold" pill>God</Badge>
          <Badge v-if="profile.educational_role && profile.educational_role !== 'god'" variant="info" pill>
            {{ profile.educational_role }}
          </Badge>
          <Badge
            v-if="subscription"
            :variant="subscription.status === 'active' ? 'success' : 'warning'"
            pill
          >
            {{ subscription.plan_name || subscription.status }}
          </Badge>
        </div>
      </div>

      <!-- Course progress cards -->
      <div v-if="enrollments.length > 0" class="section">
        <h3 class="section-title">Courses ({{ enrollments.length }})</h3>
        <div class="course-cards">
          <div v-for="enrollment in enrollments" :key="enrollment.course_id" class="course-card">
            <div class="course-header">
              <span class="course-name">{{ parseCourseCode(enrollment.course_id).label }}</span>
              <Badge
                :belt="getBeltForSeeds(getCourseProgress(enrollment.course_id).seeds_introduced).name as any"
                size="sm"
                pill
              >
                {{ getBeltForSeeds(getCourseProgress(enrollment.course_id).seeds_introduced).name }}
              </Badge>
            </div>
            <div class="course-stats">
              <div class="course-stat">
                <span class="course-stat-value">{{ getCourseProgress(enrollment.course_id).seeds_introduced }}</span>
                <span class="course-stat-label">Seeds</span>
              </div>
              <div class="course-stat">
                <span class="course-stat-value">{{ getCourseProgress(enrollment.course_id).legos_seen }}</span>
                <span class="course-stat-label">LEGOs seen</span>
              </div>
              <div class="course-stat">
                <span class="course-stat-value">{{ getCourseProgress(enrollment.course_id).legos_retired }}</span>
                <span class="course-stat-label">Retired</span>
              </div>
              <div class="course-stat">
                <span class="course-stat-value">{{ formatDuration(enrollment.total_practice_minutes || 0) }}</span>
                <span class="course-stat-label">Practice</span>
              </div>
            </div>
            <div class="course-footer">
              <span class="text-muted">
                Last active: {{ enrollment.last_practiced_at ? timeAgo(enrollment.last_practiced_at) : 'never' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Session history -->
      <div class="section">
        <h3 class="section-title">Recent Sessions ({{ sessions.length }})</h3>
        <div v-if="sessions.length > 0" class="table-container">
          <table class="sessions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Course</th>
                <th>Duration</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in sessions" :key="session.id">
                <td>{{ new Date(session.started_at).toLocaleString() }}</td>
                <td>
                  <Badge variant="default" size="sm" pill>
                    {{ parseCourseCode(session.course_id).label }}
                  </Badge>
                </td>
                <td class="text-muted">
                  {{ session.duration_seconds ? formatDuration(session.duration_seconds / 60) : '—' }}
                </td>
                <td class="text-muted">{{ session.items_practiced || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-state">No sessions recorded.</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.admin-user-detail {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
}

.breadcrumb-link {
  background: none;
  border: none;
  color: var(--text-secondary, #a0a0b8);
  cursor: pointer;
  padding: 0;
  font-size: inherit;
  font-family: inherit;
}

.breadcrumb-link:hover {
  color: var(--text-primary, #e8e8f0);
}

.breadcrumb-sep {
  color: var(--text-secondary, #a0a0b8);
}

.breadcrumb-current {
  color: var(--text-primary, #e8e8f0);
  font-weight: 500;
}

/* Profile card */
.profile-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 24px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.profile-name {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #e8e8f0);
}

.profile-meta {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a0a0b8);
  margin-top: 4px;
  display: flex;
  gap: 8px;
}

.meta-sep {
  opacity: 0.4;
}

.profile-id {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  opacity: 0.6;
}

.profile-badges {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* Section */
.section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #e8e8f0);
}

/* Course cards */
.course-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.course-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.course-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.course-name {
  font-weight: 600;
  color: var(--text-primary, #e8e8f0);
}

.course-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.course-stat {
  text-align: center;
}

.course-stat-value {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary, #e8e8f0);
}

.course-stat-label {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-secondary, #a0a0b8);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-top: 2px;
}

.course-footer {
  font-size: 0.8125rem;
}

/* Sessions table */
.table-container {
  overflow-x: auto;
}

.sessions-table {
  width: 100%;
  border-collapse: collapse;
}

.sessions-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #a0a0b8);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.sessions-table td {
  padding: 10px 12px;
  font-size: 0.875rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--text-primary, #e8e8f0);
}

.text-muted {
  color: var(--text-secondary, #a0a0b8);
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
  padding: 24px;
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.875rem;
}

@media (max-width: 768px) {
  .profile-card {
    flex-direction: column;
  }

  .course-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
