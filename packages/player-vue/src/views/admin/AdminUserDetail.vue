<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useAdminUserDetail } from '@/composables/admin/useAdminUserDetail'
import { parseCourseCode, getBeltForSeeds, timeAgo, formatDuration } from '@/composables/admin/adminUtils'
import Badge from '@/components/schools/shared/Badge.vue'
import Sparkline from '@/components/schools/shared/Sparkline.vue'

const { getClient, getAuthToken } = useAdminClient()
const route = useRoute()
const router = useRouter()
const {
  profile,
  enrollments,
  sessions,
  userEntitlements,
  playerEvents,
  l1State,
  legoMetrics,
  isLoading,
  error,
  roleUpdateStatus,
  fetchUserDetail,
  updateUserRole,
  grantEntitlement,
  revokeEntitlement,
  getCourseProgress,
} = useAdminUserDetail(getClient())

// ─── Diagnostic helpers (recent telemetry digest) ──────────────────
// All derived from the already-loaded playerEvents / l1State / legoMetrics
// so no extra fetches. Visualisation is intentionally minimal — the
// schools-aesthetic redesign agent will re-skin once their pass lands;
// this layer just makes the data legible.

function l1StageFor(fc: number): 1 | 2 | 3 | 4 {
  if (fc <= 3) return 1
  if (fc <= 6) return 2
  if (fc <= 9) return 3
  return 4
}

const l1StateByCourse = computed(() => {
  const m = new Map<string, typeof l1State.value>()
  for (const row of l1State.value) {
    const arr = m.get(row.course_code) || []
    arr.push(row)
    m.set(row.course_code, arr)
  }
  return m
})

const l1StageDistribution = computed(() => {
  const dist: Record<string, { 1: number; 2: number; 3: number; 4: number; total: number }> = {}
  for (const row of l1State.value) {
    const d = dist[row.course_code] ||= { 1: 0, 2: 0, 3: 0, 4: 0, total: 0 }
    d[l1StageFor(row.fire_count)]++
    d.total++
  }
  return dist
})

const eventCountsByType = computed(() => {
  const c = new Map<string, number>()
  for (const ev of playerEvents.value) {
    c.set(ev.event_type, (c.get(ev.event_type) ?? 0) + 1)
  }
  return [...c.entries()]
    .map(([type, n]) => ({ type, n }))
    .sort((a, b) => b.n - a.n)
})

// Audio plays grouped by cycleType — see what they actually heard.
const audioPlaysByCycleType = computed(() => {
  const c = new Map<string, number>()
  for (const ev of playerEvents.value) {
    if (ev.event_type !== 'audio_play') continue
    const p = ev.payload as Record<string, unknown> | null
    const ct = (p && typeof p.cycleType === 'string') ? p.cycleType : '(unknown)'
    c.set(ct, (c.get(ct) ?? 0) + 1)
  }
  return [...c.entries()]
    .map(([type, n]) => ({ type, n }))
    .sort((a, b) => b.n - a.n)
})

// L1 cluster fires — most recent first. Round comes from the cycle id
// pattern (script-absolute, not chunk-local).
const l1ClusterFires = computed(() => {
  return playerEvents.value
    .filter(ev => ev.event_type === 'l1_cluster_start')
    .map(ev => ({
      id: ev.id,
      at: ev.occurred_at,
      course: ev.course_code,
      round: (ev.payload as any)?.round ?? null,
      cycleId: (ev.payload as any)?.cycleId ?? '',
    }))
})

const legoMetricsByMastery = computed(() => {
  const c: Record<string, number> = { acquisition: 0, consolidating: 0, confident: 0, mastered: 0 }
  for (const row of legoMetrics.value) c[row.mastery_state] = (c[row.mastery_state] ?? 0) + 1
  return c
})

const expandedEventId = ref<number | null>(null)
function toggleEvent(id: number) {
  expandedEventId.value = expandedEventId.value === id ? null : id
}
function eventTime(t: string): string {
  try {
    const d = new Date(t)
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return t }
}
// Ranges of session_ids — group consecutive same-session events visually.
function eventSessionTag(sessionId: string | null): string {
  if (!sessionId) return ''
  return sessionId.slice(0, 6) // short hash for visual grouping
}

// ─── Activity stats (derived from learner_speaking_opportunities rows
// already loaded into `sessions`). Sessions are per-day rollups, so we
// bucket-sum + check the day key directly rather than parsing wall-clock
// timestamps for each cycle. ────────────────────────────────────────────

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const lifetimePracticeSeconds = computed(() =>
  sessions.value.reduce((sum, s) => sum + (s.duration_seconds || 0), 0),
)

const last7dPracticeSeconds = computed(() => {
  const cutoff = Date.now() - 7 * 86400 * 1000
  return sessions.value
    .filter(s => new Date(s.started_at).getTime() >= cutoff)
    .reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
})

const todayPracticeSeconds = computed(() => {
  const today = dayKey(new Date())
  return sessions.value
    .filter(s => s.started_at.slice(0, 10) === today)
    .reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
})

const sparkline30d = computed(() => {
  const buckets: number[] = new Array(30).fill(0)
  const now = Date.now()
  for (const s of sessions.value) {
    const t = new Date(s.started_at).getTime()
    const daysAgo = Math.floor((now - t) / 86400000)
    if (daysAgo >= 0 && daysAgo < 30) {
      // Stack minutes; cap visual outliers by sqrt so single big sessions
      // don't flatten the rest of the chart.
      buckets[29 - daysAgo] += (s.duration_seconds || 0) / 60
    }
  }
  return buckets
})

const currentStreak = computed(() => {
  const days = new Set(sessions.value.map(s => s.started_at.slice(0, 10)))
  if (days.size === 0) return 0
  let streak = 0
  const cursor = new Date()
  // Grace: if today has no row yet, start counting from yesterday so a
  // 9 AM check doesn't reset an actually-active streak.
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (days.has(dayKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
})

const lastActiveAt = computed(() => sessions.value[0]?.started_at ?? null)

function formatMinutes(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  if (mins < 1) return seconds > 0 ? '<1m' : '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// ─── Courses split: active (recent or non-trivial practice) vs dormant
// (opened but never really practised). 30 courses showing "0 / 0 / 0 / <1m
// / never" is pure noise — collapse them into a single line. ────────────

type Enrollment = (typeof enrollments.value)[number]

const ACTIVE_PRACTICE_FLOOR_MIN = 1
const ACTIVE_RECENT_DAYS = 30

const activeEnrollments = computed<Enrollment[]>(() => {
  const cutoff = Date.now() - ACTIVE_RECENT_DAYS * 86400 * 1000
  return enrollments.value
    .filter((e: any) => {
      if ((e.total_practice_minutes || 0) >= ACTIVE_PRACTICE_FLOOR_MIN) return true
      if (e.last_practiced_at && new Date(e.last_practiced_at).getTime() >= cutoff) return true
      return false
    })
    .sort((a: any, b: any) => {
      const tA = a.last_practiced_at ? new Date(a.last_practiced_at).getTime() : 0
      const tB = b.last_practiced_at ? new Date(b.last_practiced_at).getTime() : 0
      return tB - tA
    })
})

const dormantEnrollments = computed<Enrollment[]>(() =>
  enrollments.value.filter((e: any) => !activeEnrollments.value.includes(e)),
)

const showDormant = ref(false)

const showGrantForm = ref(false)
const grantAccessType = ref('full')
const grantDurationType = ref('lifetime')
const grantDurationDays = ref(365)
const grantCourses = ref<string[]>([])
const grantLoading = ref(false)

onMounted(() => {
  const learnerId = route.params.learnerId as string
  if (learnerId) {
    fetchUserDetail(learnerId)
  }
})

function goBack() {
  router.push('/admin/users')
}

function getUserInitials(name: string | undefined): string {
  if (!name) return '??'
  return name.substring(0, 2).toUpperCase()
}

type Tone = 'blue' | 'gold' | 'red' | 'green'

function beltTone(beltName: string): Tone | undefined {
  switch (beltName) {
    case 'yellow': return 'gold'
    case 'orange': return 'red'
    case 'green': return 'green'
    case 'blue': return 'blue'
    case 'purple': return 'blue'
    case 'brown': return 'gold'
    case 'black': return 'gold'
    default: return undefined
  }
}

function handlePlatformRoleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value || null
  if (profile.value) {
    updateUserRole(profile.value.id, 'platform_role', value)
  }
}

function handleEducationalRoleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value || null
  if (profile.value) {
    updateUserRole(profile.value.id, 'educational_role', value)
  }
}

async function handleGrant() {
  if (!profile.value) return
  grantLoading.value = true
  const success = await grantEntitlement(
    profile.value.id,
    {
      access_type: grantAccessType.value,
      granted_courses: grantAccessType.value === 'courses' ? grantCourses.value : undefined,
      duration_type: grantDurationType.value,
      duration_days: grantDurationType.value === 'time_limited' ? grantDurationDays.value : undefined,
    },
    getAuthToken
  )
  grantLoading.value = false
  if (success) {
    showGrantForm.value = false
    grantAccessType.value = 'full'
    grantDurationType.value = 'lifetime'
    grantCourses.value = []
  }
}

async function handleRevoke(entitlementId: string) {
  if (!profile.value || !confirm('Revoke this entitlement?')) return
  await revokeEntitlement(profile.value.id, entitlementId, getAuthToken)
}
</script>

<template>
  <div class="admin-user-detail">
    <!-- Breadcrumb -->
    <nav class="breadcrumb">
      <button class="breadcrumb-link" @click="goBack">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Users
      </button>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">{{ profile?.display_name || 'Loading…' }}</span>
      <button
        v-if="profile"
        class="breadcrumb-action"
        @click="$router.push(`/admin/users/${$route.params.learnerId}/progress`)"
        title="Open the learner's own progress dashboard"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        Learner dashboard
      </button>
    </nav>

    <!-- Error -->
    <div v-if="error" class="banner banner-error">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="loading">Loading user detail…</div>

    <template v-else-if="profile">
      <!-- Profile panel -->
      <div class="schools-card profile-panel">
        <div class="profile-layout">
          <div class="profile-avatar">
            {{ getUserInitials(profile.display_name) }}
          </div>
          <div class="profile-info">
            <div class="profile-header">
              <div class="profile-id-block">
                <h2 class="profile-name frost-display">
                  {{ profile.display_name || 'Anonymous' }}
                </h2>
                <div v-if="profile.emails.length > 0" class="profile-emails">
                  <div
                    v-for="email in profile.emails"
                    :key="email"
                    class="profile-email-row"
                  >
                    <span class="profile-email-text frost-mono-nums">{{ email }}</span>
                    <span v-if="email === profile.primary_email" class="email-primary-pill">primary</span>
                  </div>
                </div>
                <div class="profile-meta">
                  <span>Joined {{ new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }}</span>
                  <span class="meta-dot"></span>
                  <span class="profile-uid frost-mono-nums">{{ profile.user_id }}</span>
                </div>
              </div>
              <div class="profile-badges">
                <Badge v-if="profile.platform_role === 'ssi_admin'" variant="ssi-red" pill>Admin</Badge>
                <Badge v-if="profile.educational_role === 'god'" variant="ssi-gold" pill>God</Badge>
                <Badge
                  v-if="profile.educational_role && profile.educational_role !== 'god'"
                  variant="info"
                  pill
                >
                  {{ profile.educational_role }}
                </Badge>
              </div>
            </div>

            <!-- Role editor -->
            <div class="role-editor">
              <div class="role-field">
                <label class="schools-kicker">Platform role</label>
                <select
                  class="frost-select"
                  :value="profile.platform_role || ''"
                  @change="handlePlatformRoleChange"
                >
                  <option value="">None</option>
                  <option value="ssi_admin">ssi_admin</option>
                </select>
              </div>
              <div class="role-field">
                <label class="schools-kicker">Educational role</label>
                <select
                  class="frost-select"
                  :value="profile.educational_role || ''"
                  @change="handleEducationalRoleChange"
                >
                  <option value="">None</option>
                  <option value="god">god</option>
                  <option value="govt_admin">govt_admin</option>
                  <option value="school_admin">school_admin</option>
                  <option value="teacher">teacher</option>
                  <option value="student">student</option>
                </select>
              </div>
              <span
                v-if="roleUpdateStatus === 'saved'"
                class="role-status role-saved"
              >Saved</span>
              <span
                v-if="roleUpdateStatus === 'error'"
                class="role-status role-error"
              >Failed</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── Activity hero ──────────────────────────────────────────
           At-a-glance: is this user actually using the app?
           Lifetime / 7-day / today / streak + a 30-day sparkline.
           Reads from `sessions` (per-day rollup from
           learner_speaking_opportunities — the canonical telemetry). -->
      <section class="section">
        <div class="schools-card schools-card-pad activity-hero">
          <div class="activity-stats">
            <div class="activity-stat">
              <div class="schools-kicker">Lifetime</div>
              <div class="arsenal activity-value">{{ formatMinutes(lifetimePracticeSeconds) }}</div>
            </div>
            <div class="activity-stat">
              <div class="schools-kicker">Last 7 days</div>
              <div class="arsenal activity-value">{{ formatMinutes(last7dPracticeSeconds) }}</div>
            </div>
            <div class="activity-stat">
              <div class="schools-kicker">Today</div>
              <div class="arsenal activity-value">{{ formatMinutes(todayPracticeSeconds) }}</div>
            </div>
            <div class="activity-stat">
              <div class="schools-kicker">Streak</div>
              <div class="arsenal activity-value">
                {{ currentStreak === 0 ? '—' : `${currentStreak}d` }}
              </div>
            </div>
            <div class="activity-stat activity-stat-wide">
              <div class="schools-kicker">Last active</div>
              <div class="activity-last-active">
                {{ lastActiveAt ? timeAgo(lastActiveAt) : 'never' }}
              </div>
            </div>
          </div>
          <div v-if="lifetimePracticeSeconds > 0" class="activity-chart">
            <div class="schools-kicker activity-chart-label">Practice · last 30 days</div>
            <Sparkline
              :data="sparkline30d"
              :width="800"
              :height="48"
              color="var(--schools-red)"
            />
          </div>
          <div v-else class="activity-empty">
            <span class="schools-subtle">No practice recorded yet.</span>
          </div>
        </div>
      </section>

      <!-- Entitlements section -->
      <section class="section">
        <div class="section-head">
          <h3 class="section-title frost-display">
            Entitlements
            <span class="title-count frost-mono-nums">{{ userEntitlements.length }}</span>
          </h3>
          <button class="btn-ghost" @click="showGrantForm = !showGrantForm">
            {{ showGrantForm ? 'Cancel' : '+ Grant' }}
          </button>
        </div>

        <!-- Grant form (collapsed by default; toggled via section-head button) -->
        <Transition name="reveal">
          <div v-if="showGrantForm" class="schools-card grant-panel">
            <div class="panel-head">
              <span class="schools-kicker">Grant entitlement</span>
            </div>
            <div class="grant-form">
              <div class="grant-row">
                <div class="grant-field">
                  <label class="schools-kicker">Access</label>
                  <select v-model="grantAccessType" class="frost-select">
                    <option value="full">Full · all courses</option>
                    <option value="courses">Specific courses</option>
                  </select>
                </div>
                <div class="grant-field">
                  <label class="schools-kicker">Duration</label>
                  <select v-model="grantDurationType" class="frost-select">
                    <option value="lifetime">Lifetime</option>
                    <option value="time_limited">Time limited</option>
                  </select>
                </div>
                <div v-if="grantDurationType === 'time_limited'" class="grant-field grant-field-narrow">
                  <label class="schools-kicker">Days</label>
                  <input
                    v-model.number="grantDurationDays"
                    type="number"
                    min="1"
                    class="frost-input"
                  />
                </div>
              </div>
              <div v-if="grantAccessType === 'courses'" class="grant-field">
                <label class="schools-kicker">Course codes <span class="optional">(comma-separated)</span></label>
                <input
                  class="frost-input"
                  placeholder="e.g. spa_for_eng, fra_for_eng"
                  @input="grantCourses = ($event.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)"
                />
              </div>
              <div class="field-actions">
                <button class="btn-primary" :disabled="grantLoading" @click="handleGrant">
                  {{ grantLoading ? 'Granting…' : 'Grant entitlement' }}
                </button>
              </div>
            </div>
          </div>
        </Transition>

        <!-- Entitlements list -->
        <div
          v-if="userEntitlements.length > 0"
          class="schools-card list-panel"
        >
          <table class="list-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Access</th>
                <th>Courses</th>
                <th>Expires</th>
                <th>Granted</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ent in userEntitlements" :key="ent.id">
                <td class="cell-strong">{{ ent.label }}</td>
                <td>
                  <span
                    class="access-pill"
                    :class="ent.access_type === 'full' ? 'tone-green' : 'tone-blue'"
                  >
                    {{ ent.access_type }}
                  </span>
                </td>
                <td class="cell-muted">
                  {{ ent.granted_courses ? ent.granted_courses.join(', ') : 'All' }}
                </td>
                <td class="cell-muted frost-mono-nums">
                  {{ ent.expires_at ? new Date(ent.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Never' }}
                </td>
                <td class="cell-muted">{{ timeAgo(ent.redeemed_at) }}</td>
                <td class="cell-actions">
                  <button class="row-action is-danger" title="Revoke" @click="handleRevoke(ent.id)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="schools-card ent-empty">
          <span>No active entitlements.</span>
        </div>
      </section>

      <!-- Course progress — split into "active" (anything with real
           practice or activity in the last 30 days) and "dormant"
           (opened but never played). Most learners have 30+ dormant
           rows so we collapse them behind a toggle. -->
      <section v-if="enrollments.length > 0" class="section">
        <div class="section-head">
          <h3 class="section-title frost-display">
            Active courses
            <span class="title-count frost-mono-nums">{{ activeEnrollments.length }}</span>
          </h3>
          <button
            v-if="dormantEnrollments.length > 0"
            class="btn-ghost"
            @click="showDormant = !showDormant"
          >
            {{ showDormant ? 'Hide' : 'Show' }} {{ dormantEnrollments.length }} dormant
          </button>
        </div>
        <div v-if="activeEnrollments.length > 0" class="course-grid">
          <div
            v-for="enrollment in activeEnrollments"
            :key="enrollment.course_id"
            class="schools-card course-tile"
          >
            <div class="course-inner">
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
                  <span class="stat-value frost-mono-nums">{{ getCourseProgress(enrollment.course_id).seeds_introduced }}</span>
                  <span class="stat-label">Seeds</span>
                </div>
                <div class="course-stat">
                  <span class="stat-value frost-mono-nums">{{ getCourseProgress(enrollment.course_id).legos_seen }}</span>
                  <span class="stat-label">LEGOs</span>
                </div>
                <div class="course-stat">
                  <span class="stat-value frost-mono-nums">{{ getCourseProgress(enrollment.course_id).legos_retired }}</span>
                  <span class="stat-label">Retired</span>
                </div>
                <div class="course-stat">
                  <span class="stat-value frost-mono-nums">{{ formatDuration(enrollment.total_practice_minutes || 0) }}</span>
                  <span class="stat-label">Practice</span>
                </div>
              </div>
              <div class="course-foot">
                Last active
                <span class="course-active-time frost-mono-nums">
                  {{ enrollment.last_practiced_at ? timeAgo(enrollment.last_practiced_at) : 'never' }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="schools-card ent-empty">
          <span>No active courses yet.</span>
        </div>

        <div v-if="showDormant && dormantEnrollments.length > 0" class="schools-card list-panel dormant-panel">
          <div class="panel-head">
            <span class="schools-kicker">Dormant — opened, never practised</span>
          </div>
          <ul class="dormant-list">
            <li v-for="e in dormantEnrollments" :key="e.course_id" class="dormant-row">
              <span class="dormant-name">{{ parseCourseCode(e.course_id).label }}</span>
              <span class="dormant-meta frost-mono-nums">
                {{ e.last_practiced_at ? timeAgo(e.last_practiced_at) : 'never' }}
              </span>
            </li>
          </ul>
        </div>
      </section>

      <!-- Recent activity (per-day rollup from learner_speaking_opportunities) -->
      <section class="section">
        <h3 class="section-title frost-display">
          Recent activity
          <span class="title-count frost-mono-nums">{{ sessions.length }}</span>
        </h3>
        <div
          v-if="sessions.length > 0"
          class="schools-card list-panel"
        >
          <table class="list-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Course</th>
                <th>Practice</th>
                <th>Opportunities</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="session in sessions" :key="session.id">
                <td class="cell-muted frost-mono-nums">
                  {{ new Date(session.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }}
                </td>
                <td>
                  <Badge variant="default" size="sm" pill>
                    {{ parseCourseCode(session.course_id).label }}
                  </Badge>
                </td>
                <td class="cell-muted frost-mono-nums">
                  {{ session.duration_seconds ? formatDuration(session.duration_seconds / 60) : '—' }}
                </td>
                <td class="cell-muted frost-mono-nums">{{ session.items_practiced || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="schools-card ent-empty">
          <span>No activity recorded.</span>
        </div>
      </section>

      <!-- Recent player events — diagnostics for "skip didn't work" etc.
           Hidden entirely when there are no events; this is a debug panel,
           not headline content. -->
      <section v-if="playerEvents.length > 0" class="section">
        <h3 class="section-title frost-display">
          Recent player events
          <span class="title-count frost-mono-nums">{{ playerEvents.length }}</span>
        </h3>
        <div
          v-if="playerEvents.length > 0"
          class="schools-card list-panel"
        >
          <table class="list-table events-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Course</th>
                <th>Session</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="ev in playerEvents" :key="ev.id">
                <tr
                  class="event-row"
                  :class="{ expanded: expandedEventId === ev.id, 'has-payload': !!ev.payload }"
                  @click="ev.payload ? toggleEvent(ev.id) : undefined"
                >
                  <td class="cell-muted frost-mono-nums">{{ eventTime(ev.occurred_at) }}</td>
                  <td><span class="event-type-pill">{{ ev.event_type }}</span></td>
                  <td class="cell-muted frost-mono-nums">{{ ev.course_code || '—' }}</td>
                  <td class="cell-muted frost-mono-nums session-tag">{{ eventSessionTag(ev.session_id) }}</td>
                  <td class="cell-muted payload-cell">
                    <span v-if="!ev.payload">—</span>
                    <span v-else-if="expandedEventId === ev.id">click to collapse</span>
                    <span v-else class="payload-preview">{{ JSON.stringify(ev.payload).slice(0, 80) }}{{ JSON.stringify(ev.payload).length > 80 ? '…' : '' }}</span>
                  </td>
                </tr>
                <tr v-if="expandedEventId === ev.id && ev.payload" :key="`${ev.id}-payload`" class="event-payload-row">
                  <td colspan="5">
                    <pre class="event-payload-pre">{{ JSON.stringify(ev.payload, null, 2) }}</pre>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div class="schools-card ent-empty">
          <span>No player events recorded.</span>
        </div>
      </section>

      <!-- ─── Event type digest ───────────────────────────────────
           Only renders if there are events — pure debug summary. -->
      <section v-if="eventCountsByType.length > 0" class="section">
        <h3 class="section-title frost-display">
          Event types (last {{ playerEvents.length }})
        </h3>
        <div class="schools-card list-panel">
          <table class="list-table">
            <thead>
              <tr><th>Event type</th><th class="num-col">Count</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in eventCountsByType" :key="row.type">
                <td><span class="event-type-pill">{{ row.type }}</span></td>
                <td class="cell-muted frost-mono-nums num-col">{{ row.n }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ─── Audio plays by cycle type ────────────────────────── -->
      <section v-if="audioPlaysByCycleType.length > 0" class="section">
        <h3 class="section-title frost-display">
          Audio plays · by cycle type
          <span class="title-count frost-mono-nums">
            {{ audioPlaysByCycleType.reduce((s, r) => s + r.n, 0) }}
          </span>
        </h3>
        <div class="schools-card list-panel">
          <table class="list-table">
            <thead>
              <tr><th>Cycle type</th><th class="num-col">Plays</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in audioPlaysByCycleType" :key="row.type">
                <td><span class="event-type-pill">{{ row.type }}</span></td>
                <td class="cell-muted frost-mono-nums num-col">{{ row.n }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ─── L1 cluster fire timeline ─────────────────────────── -->
      <section v-if="l1ClusterFires.length > 0" class="section">
        <h3 class="section-title frost-display">
          L1 cluster fires
          <span class="title-count frost-mono-nums">{{ l1ClusterFires.length }}</span>
        </h3>
        <div class="schools-card list-panel">
          <table class="list-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Course</th>
                <th class="num-col">Script round</th>
                <th>Cycle ID</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="fire in l1ClusterFires" :key="fire.id">
                <td class="cell-muted frost-mono-nums">{{ eventTime(fire.at) }}</td>
                <td class="cell-muted frost-mono-nums">{{ fire.course || '—' }}</td>
                <td class="cell-muted frost-mono-nums num-col">{{ fire.round ?? '—' }}</td>
                <td class="cell-muted frost-mono-nums">{{ fire.cycleId }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ─── L1 listening state ───────────────────────────────── -->
      <section v-if="l1State.length > 0" class="section">
        <h3 class="section-title frost-display">
          L1 listening state
          <span class="title-count frost-mono-nums">{{ l1State.length }} seeds</span>
        </h3>
        <template v-for="[courseCode, rows] in l1StateByCourse" :key="courseCode">
          <div class="schools-card list-panel l1-course-panel">
            <div class="l1-course-head">
              <span class="course-tag">{{ courseCode }}</span>
              <span class="cell-muted frost-mono-nums">
                Stages —
                1: {{ l1StageDistribution[courseCode]?.[1] ?? 0 }} ·
                2: {{ l1StageDistribution[courseCode]?.[2] ?? 0 }} ·
                3: {{ l1StageDistribution[courseCode]?.[3] ?? 0 }} ·
                4: {{ l1StageDistribution[courseCode]?.[4] ?? 0 }}
              </span>
            </div>
            <table class="list-table">
              <thead>
                <tr>
                  <th>Lego ID</th>
                  <th class="num-col">Fires</th>
                  <th class="num-col">Stage</th>
                  <th>Last fired</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.lego_id">
                  <td class="cell-muted frost-mono-nums">{{ row.lego_id }}</td>
                  <td class="cell-muted frost-mono-nums num-col">{{ row.fire_count }}</td>
                  <td class="cell-muted frost-mono-nums num-col">{{ l1StageFor(row.fire_count) }}</td>
                  <td class="cell-muted frost-mono-nums">
                    {{ row.last_fired_at ? eventTime(row.last_fired_at) : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>

      <!-- ─── Adaptive pause mastery (per-LEGO) ────────────────── -->
      <section v-if="legoMetrics.length > 0" class="section">
        <h3 class="section-title frost-display">
          Adaptive pause mastery
          <span class="title-count frost-mono-nums">{{ legoMetrics.length }} LEGOs</span>
        </h3>
        <div class="schools-card ent-empty mastery-summary">
          <span>
            Acquisition: {{ legoMetricsByMastery.acquisition }} ·
            Consolidating: {{ legoMetricsByMastery.consolidating }} ·
            Confident: {{ legoMetricsByMastery.confident }} ·
            Mastered: {{ legoMetricsByMastery.mastered }}
          </span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin-user-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* ---------- Breadcrumb ---------- */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.breadcrumb-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.1);
  color: var(--schools-fg-2);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  padding: 6px 12px;
  border-radius: var(--radius-full);
  transition: all var(--transition-base);
}

.breadcrumb-link:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.18);
  color: var(--schools-fg);
}

.breadcrumb-sep {
  color: var(--schools-fg-3);
}

.breadcrumb-current {
  color: var(--schools-fg);
  font-weight: var(--font-medium);
}

.breadcrumb-action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.1);
  border-radius: var(--radius-full);
  color: var(--schools-fg-2);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
  transition: all var(--transition-base);
}

.breadcrumb-action:hover {
  color: rgb(var(--tone-blue));
  border-color: rgba(var(--tone-blue), 0.45);
  background: rgba(var(--tone-blue), 0.10);
}

/* ---------- Banners ---------- */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

.loading {
  text-align: center;
  padding: var(--space-12);
  color: var(--schools-fg-3);
  font-size: var(--text-sm);
}

/* ---------- Profile panel ---------- */
.profile-panel {
  padding: var(--space-6);
}

.profile-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--space-5);
}

.profile-avatar {
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--schools-red), var(--ssi-gold));
  border-radius: var(--radius-lg);
  color: #fff;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  letter-spacing: 0.02em;
}

.profile-info {
  flex: 1;
  min-width: 0;
}

.profile-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
}

.profile-name {
  font-size: var(--text-2xl);
  margin: 0 0 4px;
  letter-spacing: -0.015em;
  color: var(--schools-fg);
}

.profile-emails {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 0 8px;
}

.profile-email-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.profile-email-text {
  font-size: var(--text-sm);
  color: var(--schools-fg-2);
  word-break: break-all;
}

.email-primary-pill {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: var(--font-medium);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.12);
  border: 1px solid rgba(var(--tone-green), 0.30);
  padding: 1px 7px;
  border-radius: var(--radius-full);
}

.profile-meta {
  font-size: var(--text-sm);
  color: var(--schools-fg-3);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--schools-fg-3);
}

.profile-uid {
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  opacity: 0.8;
}

.profile-badges {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* Role editor */
.role-editor {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}

.role-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.role-status {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 4px 10px;
  border-radius: var(--radius-full);
}

.role-saved {
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.14);
}

.role-error {
  color: rgb(var(--tone-red));
  background: rgba(var(--tone-red), 0.14);
}

/* ---------- Section ---------- */
.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  margin: 0;
  color: var(--schools-fg);
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.title-count {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--schools-fg-3);
}

/* ---------- Form controls (shared) ---------- */
.frost-input,
.frost-select {
  font: inherit;
  font-size: var(--text-base);
  padding: 9px 14px;
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder {
  color: var(--schools-fg-3);
}

.frost-input:focus,
.frost-select:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}

.frost-select {
  appearance: none;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8078' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

.optional {
  color: var(--schools-fg-3);
  font-weight: var(--font-normal);
  text-transform: none;
  letter-spacing: 0;
}

/* ---------- Buttons ---------- */
.btn-primary,
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 16px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-base);
}

.btn-primary {
  background: var(--schools-red);
  color: #fff;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.08), 0 4px 14px rgba(194, 58, 58, 0.22);
}

.btn-primary:hover:not(:disabled) {
  background: var(--schools-red-light);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.10), 0 8px 22px rgba(194, 58, 58, 0.28);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.55);
  color: var(--schools-fg-2);
  border-color: rgba(44, 38, 34, 0.1);
}

.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.18);
  color: var(--schools-fg);
}

/* ---------- Grant panel ---------- */
.grant-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.grant-form {
  padding: var(--space-5) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.grant-row {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.grant-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 180px;
}

.grant-field-narrow {
  flex: 0 0 100px;
  min-width: 100px;
}

.field-actions {
  display: flex;
  justify-content: flex-end;
}

.reveal-enter-active,
.reveal-leave-active {
  transition: all 240ms var(--ease-out-expo);
  overflow: hidden;
}

.reveal-enter-from,
.reveal-leave-to {
  opacity: 0;
  transform: translateY(-6px);
  max-height: 0;
}

.reveal-enter-to,
.reveal-leave-from {
  opacity: 1;
  max-height: 480px;
}

/* ---------- List panel + table ---------- */
.list-panel {
  padding: 0;
  overflow: hidden;
}

.list-table {
  width: 100%;
  border-collapse: collapse;
}

.list-table thead th {
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

.list-table thead th:last-child {
  width: 56px;
}

.list-table tbody tr {
  transition: background var(--transition-base);
}

.list-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.48);
}

.list-table td {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--schools-fg-2);
  font-size: var(--text-sm);
}

.list-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-strong {
  color: var(--schools-fg);
  font-weight: var(--font-medium);
}

.cell-muted {
  color: var(--schools-fg-3);
  white-space: nowrap;
}

/* Player events table */
.events-table .event-row.has-payload {
  cursor: pointer;
}
.events-table .event-row.expanded {
  background: rgba(96, 165, 250, 0.06);
}
.event-type-pill {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.06);
  color: var(--schools-fg);
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  font-size: 0.75rem;
  font-weight: var(--font-medium);
}
.session-tag { font-size: 0.75rem; opacity: 0.7; }
.payload-preview { font-family: var(--font-mono, ui-monospace, Menlo, monospace); font-size: 0.75rem; }
.payload-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.event-payload-row td {
  background: rgba(0, 0, 0, 0.03);
  border-top: 0;
  padding: 0 18px 12px !important;
}
.event-payload-pre {
  margin: 4px 0 0;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--schools-fg-2);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
}

.access-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.access-pill.tone-green {
  background: rgba(var(--tone-green), 0.14);
  border-color: rgba(var(--tone-green), 0.36);
  color: rgb(var(--tone-green));
}

.access-pill.tone-blue {
  background: rgba(var(--tone-blue), 0.14);
  border-color: rgba(var(--tone-blue), 0.32);
  color: rgb(var(--tone-blue));
}

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

.list-table tbody tr:hover .row-action,
.list-table tbody tr:focus-within .row-action {
  opacity: 1;
  transform: translateX(0);
}

.row-action:hover {
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(44, 38, 34, 0.1);
}

.row-action.is-danger:hover {
  color: rgb(var(--tone-red));
  background: rgba(var(--tone-red), 0.10);
  border-color: rgba(var(--tone-red), 0.32);
}

/* Inline empty (smaller than canon §5.5 for nested sections) */
.ent-empty {
  padding: var(--space-6) var(--space-8);
  text-align: center;
  color: var(--schools-fg-3);
  font-size: var(--text-sm);
}

/* ---------- Course tiles ---------- */
.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

.course-tile {
  padding: 0;
}

.course-inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
}

.course-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}

.course-name {
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--schools-fg);
  letter-spacing: -0.005em;
}

.course-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  padding: var(--space-3) 0;
  border-top: 1px solid rgba(44, 38, 34, 0.08);
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
}

.course-stat {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-value {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  color: var(--schools-fg);
  line-height: 1;
  letter-spacing: -0.025em;
}

.stat-label {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--schools-fg-3);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.course-foot {
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.course-active-time {
  color: var(--schools-fg-2);
  font-weight: var(--font-medium);
}

/* ---------- Responsive ---------- */
@media (max-width: 768px) {
  .profile-layout {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .profile-header {
    flex-direction: column;
    align-items: center;
  }
  .profile-meta {
    justify-content: center;
  }
  .profile-badges {
    justify-content: center;
  }
  .role-editor {
    flex-wrap: wrap;
    justify-content: center;
  }
  .course-stats {
    grid-template-columns: repeat(2, 1fr);
  }
  .grant-row {
    flex-direction: column;
  }
  .breadcrumb-action {
    margin-left: 0;
  }
}

/* ─── Activity hero ─────────────────────────────────────────────── */

.activity-hero {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.activity-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr) 1.4fr;
  gap: 18px;
  align-items: flex-end;
}

.activity-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.activity-stat-wide {
  border-left: 1px solid var(--schools-border);
  padding-left: 18px;
}

.activity-value {
  font-size: 30px;
  line-height: 1;
  color: var(--schools-fg);
  font-feature-settings: "tnum";
}

.activity-last-active {
  font-size: 15px;
  color: var(--schools-fg);
  line-height: 1.2;
}

.activity-chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.activity-chart-label {
  color: var(--schools-fg-3);
}

.activity-empty {
  padding: 12px 0;
}

/* ─── Dormant courses list ──────────────────────────────────────── */

.dormant-panel {
  margin-top: 14px;
}

.dormant-list {
  margin: 0;
  padding: 0 18px 18px;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 4px 24px;
}

.dormant-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}

.dormant-name {
  color: var(--schools-fg-2);
}

.dormant-meta {
  color: var(--schools-fg-3);
  font-size: 11.5px;
}

@media (max-width: 880px) {
  .activity-stats {
    grid-template-columns: repeat(2, 1fr);
  }
  .activity-stat-wide {
    grid-column: 1 / -1;
    border-left: none;
    border-top: 1px solid var(--schools-border);
    padding-left: 0;
    padding-top: 14px;
  }
}
</style>
