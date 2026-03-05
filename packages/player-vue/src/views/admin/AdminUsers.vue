<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminUsers } from '@/composables/admin/useAdminUsers'
import { parseCourseCode, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import SearchBox from '@/components/schools/shared/SearchBox.vue'
import FilterDropdown from '@/components/schools/shared/FilterDropdown.vue'
import Badge from '@/components/schools/shared/Badge.vue'

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
} = useAdminUsers()

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
    <h2 class="page-title">Users</h2>

    <!-- Hero stat cards -->
    <div class="stat-cards">
      <div class="stat-card">
        <div class="stat-value">{{ totalUsers.toLocaleString() }}</div>
        <div class="stat-label">Total Users</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ newThisWeek.toLocaleString() }}</div>
        <div class="stat-label">New This Week</div>
      </div>
    </div>

    <!-- Search and filters -->
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
            <td class="text-muted">{{ new Date(user.created_at).toLocaleDateString() }}</td>
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
                <span v-if="getUserEnrollments(user.id).length === 0" class="text-muted">—</span>
              </div>
            </td>
            <td class="text-muted">
              {{ getLastActive(user.id) ? timeAgo(getLastActive(user.id)!) : '—' }}
            </td>
            <td class="text-muted">
              {{ getTotalPracticeMinutes(user.id) > 0 ? formatDuration(getTotalPracticeMinutes(user.id)) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">No users found.</div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="pagination">
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
  </div>
</template>

<style scoped>
.admin-users {
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
  grid-template-columns: repeat(2, 1fr);
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

.stat-label {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a0a0b8);
  margin-top: 8px;
}

/* Toolbar */
.toolbar {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.toolbar .search-box {
  flex: 1;
  min-width: 200px;
}

.filters {
  display: flex;
  gap: 8px;
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
  padding: 10px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #a0a0b8);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.users-table td {
  padding: 12px;
  font-size: 0.875rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--text-primary, #e8e8f0);
}

.user-row {
  cursor: pointer;
  transition: background 0.15s;
}

.user-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.user-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.name-text {
  font-weight: 500;
}

.course-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
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
  padding: 40px;
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.875rem;
}

/* Pagination */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.page-btn {
  padding: 8px 16px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-primary, #e8e8f0);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all 0.15s;
}

.page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a0a0b8);
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
