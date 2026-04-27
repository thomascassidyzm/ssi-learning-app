<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminUsers } from '@/composables/admin/useAdminUsers'
import { parseCourseCode, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import SearchBox from '@/components/schools/shared/SearchBox.vue'
import FilterDropdown from '@/components/schools/shared/FilterDropdown.vue'
import Badge from '@/components/schools/shared/Badge.vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

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
const courseOptions = ref<{ value: string; label: string }[]>([])

function handleSearch() {
  setSearch(searchInput.value)
}

function handleClear() {
  searchInput.value = ''
  setSearch('')
}

// Reset list whenever the input is emptied (X button, backspace, select-all+delete)
watch(searchInput, (next, prev) => {
  if (prev && !next.trim()) setSearch('')
})

function navigateToUser(learnerId: string) {
  router.push(`/admin/users/${learnerId}`)
}

onMounted(async () => {
  await fetchAll()

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
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Users</h1>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ totalUsers }}</span>
            users
          </span>
          <span v-if="newThisWeek > 0" class="metric-sep">·</span>
          <span v-if="newThisWeek > 0" class="metric metric-fresh">
            <span class="metric-value frost-mono-nums">{{ newThisWeek }}</span>
            new this week
          </span>
        </div>
      </div>
    </header>

    <!-- Filters bar — canon §5.2 (its own row, NOT inside a card header) -->
    <div class="filters-bar">
      <SearchBox
        v-model="searchInput"
        placeholder="Search by name or email…"
        block
        size="md"
        @search="handleSearch"
        @clear="handleClear"
      />
      <FilterDropdown
        :model-value="courseFilter"
        :options="courseOptions"
        placeholder="All courses"
        size="md"
        @update:model-value="setCourseFilter"
      />
    </div>

    <!-- Error -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading users…</div>

    <!-- List panel (canon §5.3 table-inside-panel) -->
    <FrostCard v-else-if="users.length > 0" variant="panel" class="list-panel">
      <table class="users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Joined</th>
            <th>Courses</th>
            <th>Last active</th>
            <th>Practice time</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="user in users"
            :key="user.id"
            class="user-row"
            tabindex="0"
            @click="navigateToUser(user.id)"
            @keydown.enter="navigateToUser(user.id)"
          >
            <td class="cell-name">
              <span class="name-text">{{ user.display_name || 'Anonymous' }}</span>
              <Badge
                v-if="user.platform_role === 'ssi_admin'"
                variant="ssi-red"
                size="sm"
                pill
              >admin</Badge>
              <Badge
                v-else-if="user.educational_role === 'god'"
                variant="ssi-gold"
                size="sm"
                pill
              >god</Badge>
            </td>
            <td class="cell-email">
              <template v-if="user.primary_email">
                <span class="email-text" :title="user.emails.join(', ')">{{ user.primary_email }}</span>
                <span
                  v-if="user.emails.length > 1"
                  class="email-extras"
                  :title="user.emails.filter(e => e !== user.primary_email).join('\n')"
                >
                  +{{ user.emails.length - 1 }}
                </span>
              </template>
              <span v-else class="cell-faint">—</span>
            </td>
            <td class="cell-muted frost-mono-nums">
              {{ new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) }}
            </td>
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
                <span v-if="getUserEnrollments(user.id).length === 0" class="cell-faint">—</span>
              </div>
            </td>
            <td class="cell-muted">
              {{ getLastActive(user.id) ? timeAgo(getLastActive(user.id)!) : '—' }}
            </td>
            <td class="cell-muted frost-mono-nums">
              {{ getTotalPracticeMinutes(user.id) > 0 ? formatDuration(getTotalPracticeMinutes(user.id)) : '—' }}
            </td>
            <td class="cell-actions">
              <button
                class="row-action"
                title="View user detail"
                @click.stop="navigateToUser(user.id)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination footer -->
      <div v-if="totalPages > 1" class="pagination">
        <button
          class="page-btn"
          :disabled="currentPage <= 1"
          @click="setPage(currentPage - 1)"
        >
          Prev
        </button>
        <span class="page-info frost-mono-nums">
          Page {{ currentPage }} of {{ totalPages }}
        </span>
        <button
          class="page-btn"
          :disabled="currentPage >= totalPages"
          @click="setPage(currentPage + 1)"
        >
          Next
        </button>
      </div>
    </FrostCard>

    <!-- Empty state — canon §5.5 -->
    <FrostCard v-else variant="tile" class="empty">
      <div class="empty-ghost">users</div>
      <div class="empty-copy">
        <strong>No users {{ searchInput || courseFilter ? 'match these filters' : 'yet' }}</strong>
        <p v-if="searchInput || courseFilter">Try clearing the search or filter.</p>
        <p v-else>Once people sign up, they'll appear here.</p>
      </div>
    </FrostCard>
  </div>
</template>

<style scoped>
.admin-users {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Page header — canon §5.1 */
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-6);
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
}

.metric-value {
  color: var(--ink-primary);
  font-weight: var(--font-semibold);
  margin-right: 4px;
}

.metric-sep {
  color: var(--ink-faint);
}

.metric-fresh .metric-value {
  color: rgb(var(--tone-green));
}

/* Filters bar — canon §5.2 */
.filters-bar {
  display: flex;
  gap: var(--space-3);
  align-items: center;
}

.filters-bar :deep(.search-box) {
  flex: 1;
  min-width: 0;
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
  padding: var(--space-10);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* List panel — canon §5.3 */
.list-panel {
  padding: 0;
  overflow: hidden;
}

.users-table {
  width: 100%;
  border-collapse: collapse;
}

.users-table thead th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-muted);
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  background: rgba(255, 255, 255, 0.35);
}

.users-table thead th:last-child {
  width: 56px;
}

.users-table tbody tr {
  cursor: pointer;
  transition: background var(--transition-base);
}

.users-table tbody tr:hover,
.users-table tbody tr:focus-visible {
  background: rgba(255, 255, 255, 0.48);
  outline: none;
}

.users-table td {
  padding: 14px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.users-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-name {
  min-width: 220px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.name-text {
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--ink-primary);
  letter-spacing: -0.005em;
}

.cell-muted {
  color: var(--ink-muted);
  white-space: nowrap;
}

.cell-faint {
  color: var(--ink-faint);
}

.cell-email {
  max-width: 280px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.email-text {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  flex: 1 1 auto;
  min-width: 0;
}

.email-extras {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  color: rgb(var(--tone-blue));
  background: rgba(var(--tone-blue), 0.10);
  border: 1px solid rgba(var(--tone-blue), 0.25);
  padding: 2px 6px;
  border-radius: var(--radius-full);
  flex: 0 0 auto;
  cursor: help;
}

.course-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* Hover-reveal row actions — canon §5.6 */
.cell-actions {
  text-align: right;
  padding-right: 12px;
}

.row-action {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--ink-muted);
  cursor: pointer;
  opacity: 0;
  transform: translateX(4px);
  transition: all var(--transition-fast);
}

.users-table tbody tr:hover .row-action,
.users-table tbody tr:focus-within .row-action {
  opacity: 1;
  transform: translateX(0);
}

.row-action:hover {
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(44, 38, 34, 0.1);
}

/* Pagination */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-4);
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}

.page-btn {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.1);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: all var(--transition-base);
}

.page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.18);
  color: var(--ink-primary);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: var(--text-sm);
  color: var(--ink-muted);
}

/* Empty state — canon §5.5 */
.empty {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-6);
  align-items: center;
  padding: var(--space-10) var(--space-8);
  min-height: 200px;
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

@media (max-width: 768px) {
  .filters-bar {
    flex-direction: column;
    align-items: stretch;
  }

  /* Hide Joined (3) and Practice time (6) on mobile — Email stays visible. */
  .users-table thead th:nth-child(3),
  .users-table tbody td:nth-child(3),
  .users-table thead th:nth-child(6),
  .users-table tbody td:nth-child(6) {
    display: none;
  }

  .cell-email {
    max-width: 160px;
  }
}
</style>
