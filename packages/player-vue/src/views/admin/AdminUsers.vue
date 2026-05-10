<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminUsers } from '@/composables/admin/useAdminUsers'
import { parseCourseCode, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import SearchBox from '@/components/schools/shared/SearchBox.vue'
import FilterDropdown from '@/components/schools/shared/FilterDropdown.vue'
import Badge from '@/components/schools/shared/Badge.vue'
import Card from '@/components/schools/shared/Card.vue'
import StatsCard from '@/components/schools/StatsCard.vue'

const { getClient } = useAdminClient()
const router = useRouter()
const {
  users,
  totalCount,
  currentPage,
  totalPages,
  courseFilter,
  isLoading,
  error,
  totalUsers,
  newThisWeek,
  fetchAll,
  setPage,
  setSearch,
  setCourseFilter,
  getUserEnrollments,
  getLastActive,
  getTotalPracticeMinutes,
} = useAdminUsers(getClient())

const searchInput = ref('')

// Collect unique courses from the page for filter options
const courseOptions = ref<{ value: string; label: string }[]>([])

function handleSearch() {
  setSearch(searchInput.value)
}

function handleClear() {
  searchInput.value = ''
  setSearch('')
}

function navigateToUser(learnerId: string) {
  router.push(`/admin/users/${learnerId}`)
}

onMounted(async () => {
  await fetchAll()

  // Build course filter options from enrollment data
  const courseSet = new Set<string>()
  users.value.forEach(u => {
    getUserEnrollments(u.id).forEach(e => courseSet.add(e.course_id))
  })
  courseOptions.value = Array.from(courseSet).map(c => ({
    value: c,
    label: parseCourseCode(c).label,
  }))
})
</script>

<template>
  <div class="admin-users">
    <!-- Page Header -->
    <header class="page-header animate-in">
      <h1 class="page-title">Users</h1>
      <p class="page-subtitle">Manage learners and view progress</p>
    </header>

    <!-- Hero stat cards -->
    <div class="stat-cards animate-in delay-1">
      <StatsCard
        label="Total Users"
        :value="totalUsers"
        icon="👥"
        variant="blue"
      />
      <StatsCard
        label="New This Week"
        :value="newThisWeek"
        icon="✨"
        variant="green"
      />
    </div>

    <!-- Search/filter toolbar + users table in a single Card -->
    <Card variant="default" accent="gradient" :no-padding="true" class="animate-in delay-2">
      <template #header>
        <div class="toolbar">
          <SearchBox
            v-model="searchInput"
            placeholder="Search by name..."
            block
            size="md"
            @search="handleSearch"
            @clear="handleClear"
          />
          <div class="filters">
            <FilterDropdown
              :model-value="courseFilter"
              :options="courseOptions"
              placeholder="All courses"
              size="sm"
              @update:model-value="setCourseFilter"
            />
          </div>
        </div>
      </template>

      <!-- Error state -->
      <div v-if="error" class="error-banner">{{ error }}</div>

      <!-- Loading state -->
      <div v-if="isLoading" class="loading">Loading users...</div>

      <!-- Users table -->
      <div v-else-if="users.length > 0" class="table-container">
        <table class="users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Joined</th>
              <th>Courses</th>
              <th>Last Active</th>
              <th>Practice Time</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in users"
              :key="user.id"
              class="user-row"
              @click="navigateToUser(user.id)"
            >
              <td class="user-name">
                <span class="name-text">{{ user.display_name || 'Anonymous' }}</span>
                <Badge v-if="user.platform_role === 'ssi_admin'" variant="ssi-red" size="sm" pill>admin</Badge>
                <Badge v-else-if="user.educational_role === 'god'" variant="ssi-gold" size="sm" pill>god</Badge>
              </td>
              <td class="cell-muted">{{ new Date(user.created_at).toLocaleDateString() }}</td>
              <td>
                <div class="course-badges">
                  <Badge
                    v-for="enrollment in getUserEnrollments(user.id)"
                    :key="enrollment.course_id"
                    variant="default"
                    size="sm"
                    pill
                  >
                    {{ parseCourseCode(enrollment.course_id).label }}
                  </Badge>
                  <span v-if="getUserEnrollments(user.id).length === 0" class="cell-muted">—</span>
                </div>
              </td>
              <td class="cell-muted">
                {{ getLastActive(user.id) ? timeAgo(getLastActive(user.id)!) : '—' }}
              </td>
              <td class="cell-muted">
                {{ getTotalPracticeMinutes(user.id) > 0 ? formatDuration(getTotalPracticeMinutes(user.id)) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Empty state -->
      <div v-else class="empty-state">No users found.</div>

      <!-- Pagination -->
      <template v-if="totalPages > 1" #footer>
        <div class="pagination">
          <button
            class="page-btn"
            :disabled="currentPage <= 1"
            @click="setPage(currentPage - 1)"
          >
            Prev
          </button>
          <span class="page-info">Page {{ currentPage }} of {{ totalPages }}</span>
          <button
            class="page-btn"
            :disabled="currentPage >= totalPages"
            @click="setPage(currentPage + 1)"
          >
            Next
          </button>
        </div>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.admin-users {
  display: flex;
  flex-direction: column;
  gap: var(--space-6, 24px);
}

/* Page Header */
.page-header {
  margin-bottom: var(--space-2, 8px);
}

.page-title {
  font-family: var(--font-display);
  font-size: var(--text-3xl, 1.875rem);
  font-weight: var(--font-bold, 700);
  margin: 0 0 var(--space-1, 4px) 0;
  color: var(--text-primary);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm, 0.875rem);
  margin: 0;
}

/* Stat cards */
.stat-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-6, 24px);
}

/* Toolbar inside Card header */
.toolbar {
  display: flex;
  gap: var(--space-3, 12px);
  align-items: flex-start;
  flex-wrap: wrap;
  flex: 1;
}

.toolbar :deep(.search-box) {
  flex: 1;
  min-width: 200px;
}

.filters {
  display: flex;
  gap: var(--space-2, 8px);
  flex-shrink: 0;
}

/* Table */
.table-container {
  overflow-x: auto;
}

.users-table {
  width: 100%;
  border-collapse: collapse;
}

.users-table th {
  text-align: left;
  padding: var(--space-3, 12px) var(--space-4, 16px);
  font-size: var(--text-xs, 0.75rem);
  font-weight: var(--font-semibold, 600);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
}

.users-table td {
  padding: var(--space-3, 12px) var(--space-4, 16px);
  font-size: var(--text-sm, 0.875rem);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

.user-row {
  cursor: pointer;
  transition: background var(--transition-base, 0.15s ease);
}

.user-row:hover {
  background: var(--bg-card-hover, var(--bg-elevated));
}

.user-name {
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
}

.name-text {
  font-weight: var(--font-medium, 500);
}

.course-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1, 4px);
}

.cell-muted {
  color: var(--text-secondary);
}

/* Error */
.error-banner {
  padding: var(--space-3, 12px) var(--space-4, 16px);
  margin: var(--space-4, 16px);
  background: var(--bg-error, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--border-error, rgba(239, 68, 68, 0.3));
  border-radius: var(--radius-md, 8px);
  color: var(--text-error, #ef4444);
  font-size: var(--text-sm, 0.875rem);
}

/* Loading */
.loading {
  text-align: center;
  padding: var(--space-10, 40px);
  color: var(--text-secondary);
  font-size: var(--text-sm, 0.875rem);
}

/* Empty */
.empty-state {
  text-align: center;
  padding: var(--space-10, 40px);
  color: var(--text-secondary);
  font-size: var(--text-sm, 0.875rem);
}

/* Pagination */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4, 16px);
}

.page-btn {
  padding: var(--space-2, 8px) var(--space-4, 16px);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-size: var(--text-sm, 0.8125rem);
  font-family: inherit;
  cursor: pointer;
  transition: all var(--transition-base, 0.15s ease);
}

.page-btn:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: var(--text-sm, 0.8125rem);
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .stat-cards {
    grid-template-columns: 1fr;
  }

  .toolbar {
    flex-direction: column;
  }

  .filters {
    flex-wrap: wrap;
  }
}
</style>
