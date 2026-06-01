<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminAttention } from '@/composables/admin/useAdminAttention'
import { parseCourseCode } from '@/composables/admin/adminUtils'

const { getClient } = useAdminClient()
const router = useRouter()
const {
  flagged,
  healthy,
  totalSubscribers,
  highCount,
  mediumCount,
  isLoading,
  error,
  fetchAll,
} = useAdminAttention(getClient())

function courseLabel(code: string | null): string {
  return code ? parseCourseCode(code).label : ''
}

function navigateToUser(learnerId: string) {
  router.push(`/admin/users/${learnerId}`)
}

onMounted(async () => {
  await fetchAll()
})
</script>

<template>
  <div class="admin-attention">
    <header class="page-header">
      <div class="title-block">
        <h1 class="arsenal">Needs attention</h1>
        <div class="metrics">
          <span class="metric"><span class="metric-value mono-nums">{{ totalSubscribers }}</span> subscribers</span>
          <span v-if="highCount > 0" class="metric-sep">·</span>
          <span v-if="highCount > 0" class="metric metric-high"><span class="metric-value mono-nums">{{ highCount }}</span> urgent</span>
          <span v-if="mediumCount > 0" class="metric-sep">·</span>
          <span v-if="mediumCount > 0" class="metric metric-medium"><span class="metric-value mono-nums">{{ mediumCount }}</span> watch</span>
        </div>
      </div>
    </header>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="isLoading" class="loading">Checking subscribers…</div>

    <template v-else>
      <div v-if="flagged.length > 0" class="schools-card list-panel">
        <button
          v-for="u in flagged"
          :key="u.learner_id"
          class="attention-row"
          :class="`level-${u.level}`"
          @click="navigateToUser(u.learner_id)"
        >
          <span class="dot" :class="`dot-${u.level}`" aria-hidden="true"></span>
          <span class="who">
            <span class="who-name">{{ u.name || u.email || 'Anonymous' }}</span>
            <span v-if="u.name && u.email" class="who-email">{{ u.email }}</span>
          </span>
          <span class="reason">{{ u.reason }}</span>
          <span v-if="u.course" class="course-tag">{{ courseLabel(u.course) }}</span>
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>

      <div v-else class="schools-card empty">
        <div class="empty-ghost">✓</div>
        <div class="empty-copy">
          <strong>No one needs attention</strong>
          <p>All {{ totalSubscribers }} subscribers are active and healthy.</p>
        </div>
      </div>

      <p v-if="flagged.length > 0 && healthy > 0" class="healthy-note">
        + {{ healthy }} healthy subscriber{{ healthy === 1 ? '' : 's' }} not shown
      </p>
    </template>
  </div>
</template>

<style scoped>
.admin-attention { padding: var(--space-4, 16px); max-width: 860px; margin: 0 auto; }
.page-header { margin-bottom: var(--space-4, 16px); }
.title-block h1 { margin: 0; }
.metrics { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 0.85rem; opacity: 0.75; }
.metric-value { font-weight: 700; }
.metric-sep { opacity: 0.4; }
.metric-high { color: #c62828; opacity: 1; }
.metric-medium { color: #b8860b; opacity: 1; }

.error-banner { background: rgba(198,40,40,0.1); color: #c62828; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; }
.loading { opacity: 0.6; padding: 24px 4px; }

.list-panel { display: flex; flex-direction: column; overflow: hidden; }
.attention-row {
  display: flex; align-items: center; gap: 12px;
  width: 100%; text-align: left;
  padding: 14px 16px; background: transparent; border: none;
  border-bottom: 1px solid var(--border-subtle, rgba(0,0,0,0.07));
  cursor: pointer; font: inherit; color: inherit;
}
.attention-row:last-child { border-bottom: none; }
.attention-row:hover { background: rgba(0,0,0,0.03); }
.dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.dot-high { background: #e53935; }
.dot-medium { background: #f4b400; }
.who { display: flex; flex-direction: column; min-width: 0; flex: 0 0 30%; }
.who-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who-email { font-size: 0.78rem; opacity: 0.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reason { flex: 1 1 auto; min-width: 0; opacity: 0.8; font-size: 0.9rem; }
.course-tag { flex-shrink: 0; font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; background: rgba(0,0,0,0.06); opacity: 0.8; }
.chev { width: 16px; height: 16px; opacity: 0.35; flex-shrink: 0; }

.empty { text-align: center; padding: 48px 16px; }
.empty-ghost { font-size: 2.5rem; color: #4caf50; }
.empty-copy strong { display: block; margin-top: 8px; }
.empty-copy p { opacity: 0.6; margin-top: 4px; }
.healthy-note { text-align: center; opacity: 0.5; font-size: 0.82rem; margin-top: 12px; }
</style>
