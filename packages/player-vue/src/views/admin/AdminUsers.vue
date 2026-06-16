<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminUsers, type Tier, type SortKey } from '@/composables/admin/useAdminUsers'
import { parseCourseCode, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import SearchBox from '@/components/schools/shared/SearchBox.vue'
import FilterDropdown from '@/components/schools/shared/FilterDropdown.vue'
import Badge from '@/components/schools/shared/Badge.vue'

const { getClient } = useAdminClient()
const router = useRouter()
const {
  users,
  totalCount,
  currentPage,
  totalPages,
  courseFilter,
  tierFilter,
  sortKey,
  isLoading,
  error,
  totalUsers,
  newThisWeek,
  tierCounts,
  allEnrolledCourseIds,
  fetchAll,
  setPage,
  setSearch,
  setCourseFilter,
  setTierFilter,
  setSort,
} = useAdminUsers(getClient())

const searchInput = ref('')

// Course filter options reflect every course any user is enrolled in,
// not just courses visible on the current page slice.
const courseOptions = computed(() =>
  allEnrolledCourseIds.value.map(c => ({
    value: c,
    label: parseCourseCode(c).label,
  })),
)

// Tier filter chips — count badges let an admin see the permission split at a
// glance (the page's core job: find users / check access). null = All.
const tierChips = computed<Array<{ value: Tier | null; label: string; count: number | null }>>(() => [
  { value: null, label: 'All', count: totalUsers.value },
  { value: 'premium', label: 'Premium', count: tierCounts.value.premium },
  { value: 'free', label: 'Free', count: tierCounts.value.free },
  { value: 'admin', label: 'Admin', count: tierCounts.value.admin },
  { value: 'school', label: 'School', count: tierCounts.value.school },
])

const sortChips: Array<{ value: SortKey; label: string }> = [
  { value: 'active', label: 'Recently active' },
  { value: 'practice', label: 'Most practice' },
  { value: 'joined', label: 'Newest' },
  { value: 'name', label: 'Name' },
]

// Tier → Badge variant + label (premium = gold, admin = red, school = blue/info).
const TIER_VARIANT: Record<Tier, 'ssi-gold' | 'ssi-red' | 'info' | 'default'> = {
  premium: 'ssi-gold',
  admin: 'ssi-red',
  school: 'info',
  free: 'default',
}
const TIER_LABEL: Record<Tier, string> = {
  premium: 'Premium', admin: 'Admin', school: 'School', free: 'Free',
}

// Show at most a couple of course chips per row, then collapse the rest to a
// "+N" count — otherwise power users (and admins enrolled in everything) turn
// every row into a wall of badges. Full list is on the +N hover and the detail.
const COURSE_BADGE_CAP = 2
function courseLabels(ids: string[]): string {
  return ids.map(c => parseCourseCode(c).label).join(', ')
}

function handleSearch() {
  setSearch(searchInput.value)
}

function handleClear() {
  searchInput.value = ''
  setSearch('')
}

// Live-filter on every keystroke — list is fully loaded client-side, so this is instant.
watch(searchInput, (next) => {
  setSearch(next)
})

function navigateToUser(learnerId: string) {
  router.push(`/admin/users/${learnerId}`)
}

onMounted(async () => {
  await fetchAll()
})
</script>

<template>
  <div class="admin-users">
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="arsenal">Users</h1>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value mono-nums">{{ totalUsers }}</span>
            users
          </span>
          <span v-if="newThisWeek > 0" class="metric-sep">·</span>
          <span v-if="newThisWeek > 0" class="metric metric-fresh">
            <span class="metric-value mono-nums">{{ newThisWeek }}</span>
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

    <!-- Quick chips: tier filter (left) + sort (right) -->
    <div class="chips-bar">
      <div class="chip-group" role="group" aria-label="Filter by access tier">
        <button
          v-for="chip in tierChips"
          :key="chip.label"
          class="chip"
          :class="{ 'chip-active': tierFilter === chip.value }"
          @click="setTierFilter(chip.value)"
        >
          {{ chip.label }}
          <span v-if="chip.count != null" class="chip-count mono-nums">{{ chip.count }}</span>
        </button>
      </div>
      <div class="chip-group chip-group--sort" role="group" aria-label="Sort users">
        <span class="chip-group-label">Sort</span>
        <button
          v-for="chip in sortChips"
          :key="chip.value"
          class="chip chip--sort"
          :class="{ 'chip-active': sortKey === chip.value }"
          @click="setSort(chip.value)"
        >
          {{ chip.label }}
        </button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading users…</div>

    <!-- List panel (canon §5.3 table-inside-panel) -->
    <div v-else-if="users.length > 0" class="schools-card list-panel">
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
              <div class="cell-name-inner">
                <span class="name-text">{{ user.display_name || 'Anonymous' }}</span>
                <Badge :variant="TIER_VARIANT[user.tier]" size="sm" pill>
                  {{ TIER_LABEL[user.tier] }}
                </Badge>
              </div>
            </td>
            <td class="cell-email">
              <div class="cell-email-inner">
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
              </div>
            </td>
            <td class="cell-muted mono-nums">
              {{ new Date(user.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) }}
            </td>
            <td>
              <div class="course-badges">
                <Badge
                  v-for="courseId in user.course_ids.slice(0, COURSE_BADGE_CAP)"
                  :key="courseId"
                  variant="default"
                  size="sm"
                  pill
                >
                  {{ parseCourseCode(courseId).label }}
                </Badge>
                <span
                  v-if="user.course_ids.length > COURSE_BADGE_CAP"
                  class="course-more"
                  :title="courseLabels(user.course_ids)"
                >+{{ user.course_ids.length - COURSE_BADGE_CAP }}</span>
                <span v-if="user.course_ids.length === 0" class="cell-faint">—</span>
              </div>
            </td>
            <td class="cell-muted">
              {{ user.last_active ? timeAgo(user.last_active) : '—' }}
            </td>
            <td class="cell-muted mono-nums">
              {{ user.practice_minutes > 0 ? formatDuration(user.practice_minutes) : '—' }}
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
        <span class="page-info mono-nums">
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
    </div>

    <!-- Empty state — canon §5.5 -->
    <div v-else class="schools-card empty">
      <div class="empty-ghost">users</div>
      <div class="empty-copy">
        <strong>No users {{ searchInput || courseFilter ? 'match these filters' : 'yet' }}</strong>
        <p v-if="searchInput || courseFilter">Try clearing the search or filter.</p>
        <p v-else>Once people sign up, they'll appear here.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-users {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.mono-nums {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
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
  color: var(--schools-fg);
  margin: 0 0 var(--space-2);
}

.metrics {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--schools-fg-3);
  font-size: var(--text-sm);
}

.metric-value {
  color: var(--schools-fg);
  font-weight: var(--font-semibold);
  margin-right: 4px;
}

.metric-sep {
  color: var(--schools-fg-3);
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

/* Quick chips — tier filter + sort */
.chips-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.chip-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip-group-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
  margin-right: 2px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.1);
  color: var(--schools-fg-2);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: all var(--transition-base);
  white-space: nowrap;
}

.chip:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.18);
  color: var(--schools-fg);
}

.chip-active {
  background: var(--schools-fg);
  border-color: var(--schools-fg);
  color: var(--bg-primary, #fff);
}

.chip-active:hover {
  background: var(--schools-fg);
  color: var(--bg-primary, #fff);
}

.chip-count {
  font-size: var(--text-xs);
  opacity: 0.7;
}

.chip-active .chip-count {
  opacity: 0.85;
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
  color: var(--schools-fg-3);
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
  color: var(--schools-fg-3);
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
  color: var(--schools-fg-2);
  font-size: var(--text-sm);
}

.users-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-name {
  min-width: 220px;
}

.cell-name-inner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.name-text {
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--schools-fg);
  letter-spacing: -0.005em;
}

.cell-muted {
  color: var(--schools-fg-3);
  white-space: nowrap;
}

.cell-faint {
  color: var(--schools-fg-3);
}

.cell-email {
  max-width: 280px;
}

.cell-email-inner {
  display: flex;
  align-items: center;
  gap: 6px;
}

.email-text {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--schools-fg-2);
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
  align-items: center;
  gap: var(--space-1);
  max-width: 260px;
}

.course-more {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  color: var(--schools-fg-3);
  background: rgba(44, 38, 34, 0.06);
  border: 1px solid rgba(44, 38, 34, 0.12);
  padding: 2px 6px;
  border-radius: var(--radius-full);
  cursor: help;
  white-space: nowrap;
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
  color: var(--schools-fg-3);
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
  color: var(--schools-fg);
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
  color: var(--schools-fg-2);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: all var(--transition-base);
}

.page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.18);
  color: var(--schools-fg);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  font-size: var(--text-sm);
  color: var(--schools-fg-3);
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
  color: var(--schools-fg-3);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--schools-fg);
  margin-bottom: 4px;
}

.empty-copy p {
  margin: 0;
  color: var(--schools-fg-3);
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
