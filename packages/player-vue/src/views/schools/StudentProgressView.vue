<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useRouter } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { getSchoolsClient } from '@/composables/schools/client'
import { getLanguageName } from '@/composables/useI18n'
import JourneyBar from '@/components/schools/shared/JourneyBar.vue'
import Sparkline from '@/components/schools/shared/Sparkline.vue'
import { BELTS, type BeltName } from '@/composables/schools/belts'

interface CourseProgress {
  course_id: string
  enrolled_at: string
  last_practiced_at: string | null
  total_practice_minutes: number
  seeds_completed: number
  legos_mastered: number
  legos_retired: number
}

const { currentUser } = useSchoolContext()
const client = getSchoolsClient()
const router = useRouter()
const isAdminView = inject<boolean>('isAdminView', false)

const courses = ref<CourseProgress[]>([])
const recentSessions = ref<Array<{ started_at: string; duration_seconds: number | null }>>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

function getBeltInfo(seeds: number) {
  let i = BELTS.length - 1
  while (i > 0 && seeds < BELTS[i].min) i--
  const current = BELTS[i]
  const next = BELTS[i + 1] ?? null
  const total = next ? next.min - current.min : Math.max(1, current.min)
  const done = Math.max(0, seeds - current.min)
  return { current, next, total, done }
}

async function fetchProgress() {
  if (!currentUser.value?.learner_id) return

  isLoading.value = true
  error.value = null

  try {
    const { data: enrollments, error: enrollError } = await client
      .from('course_enrollments')
      .select('course_id, enrolled_at, last_practiced_at, total_practice_minutes')
      .eq('learner_id', currentUser.value.learner_id)
      .order('last_practiced_at', { ascending: false, nullsFirst: false })

    if (enrollError) throw enrollError

    const { data: seedCounts, error: seedError } = await client
      .from('seed_progress')
      .select('course_id')
      .eq('learner_id', currentUser.value.learner_id)
      .eq('is_introduced', true)

    if (seedError) throw seedError

    const { data: legoCounts, error: legoError } = await client
      .from('lego_progress')
      .select('course_id, is_retired')
      .eq('learner_id', currentUser.value.learner_id)

    if (legoError) throw legoError

    // Practice minutes per course from the player_events rollup RPC —
    // course_enrollments.total_practice_minutes is no longer maintained.
    const { data: minutesRows } = await client
      .rpc('admin_practice_minutes_by_course', { p_learner_ids: [currentUser.value.learner_id] })
    const minutesByCourse = new Map<string, number>()
    ;(minutesRows as Array<{ course_code: string; practice_minutes: number }> | null)?.forEach(r => {
      if (r.course_code) minutesByCourse.set(r.course_code, r.practice_minutes || 0)
    })

    const seedCountMap = new Map<string, number>()
    seedCounts?.forEach(s => {
      seedCountMap.set(s.course_id, (seedCountMap.get(s.course_id) || 0) + 1)
    })

    const legoCountMap = new Map<string, { total: number; retired: number }>()
    legoCounts?.forEach(l => {
      const existing = legoCountMap.get(l.course_id) || { total: 0, retired: 0 }
      existing.total++
      if (l.is_retired) existing.retired++
      legoCountMap.set(l.course_id, existing)
    })

    courses.value = (enrollments || []).map(e => ({
      course_id: e.course_id,
      enrolled_at: e.enrolled_at,
      last_practiced_at: e.last_practiced_at,
      total_practice_minutes: minutesByCourse.get(e.course_id) ?? 0,
      seeds_completed: seedCountMap.get(e.course_id) || 0,
      legos_mastered: legoCountMap.get(e.course_id)?.total || 0,
      legos_retired: legoCountMap.get(e.course_id)?.retired || 0,
    }))

    // Last 14 days of daily activity for the streak + sparkline, from the
    // player_events-derived rollup (learner_speaking_opportunities). The legacy
    // `sessions` table is no longer the source of truth. LSO is per-(course,day),
    // so sum play_seconds across courses into one entry per day and reuse the
    // day-keyed computeds below. Own-row RLS permits this read.
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
    const sinceDay = fourteenDaysAgo.toISOString().split('T')[0]
    const { data: activity } = await client
      .from('learner_speaking_opportunities')
      .select('day, play_seconds')
      .eq('learner_id', currentUser.value.learner_id)
      .gte('day', sinceDay)

    const secondsByDay = new Map<string, number>()
    ;(activity as Array<{ day: string; play_seconds: number }> | null)?.forEach(r => {
      secondsByDay.set(r.day, (secondsByDay.get(r.day) || 0) + (r.play_seconds || 0))
    })
    recentSessions.value = Array.from(secondsByDay.entries())
      .map(([day, seconds]) => ({ started_at: day, duration_seconds: seconds }))
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to fetch progress'
    console.error('[StudentProgress] fetch error:', err)
  } finally {
    isLoading.value = false
  }
}

onMounted(() => { fetchProgress() })
watch(currentUser, () => { fetchProgress() })

// ---------- Derived (page-level) ----------

const primaryCourse = computed(() => courses.value[0] || null)

const totalSeeds = computed(() =>
  courses.value.reduce((sum, c) => sum + c.seeds_completed, 0),
)

const belt = computed(() => getBeltInfo(totalSeeds.value))

function formatCourseName(courseId: string): string {
  const m = courseId.match(/^([a-z_]+?)_for_([a-z_]+)/)
  if (!m) return courseId
  return getLanguageName(m[1])
}

const primaryCourseName = computed(() =>
  primaryCourse.value ? formatCourseName(primaryCourse.value.course_id) : 'your course',
)

const legosRetired = computed(() => primaryCourse.value?.legos_retired || 0)
const nextLegoNumber = computed(() => legosRetired.value + 1)

// Resumes the learner's primary course — same pattern as
// DashboardView.vue/ClassDetail.vue's play launchers: stamp the course into
// localStorage, App.vue's cold-boot logic picks it up and resumes at the
// learner's own furthest progress. Self-view only (finding #7,
// 2026-07-13 audit) — an admin viewing another learner's progress must
// never launch a live play session as them.
function handleKeepGoing(): void {
  if (isAdminView || !primaryCourse.value) return
  localStorage.setItem('ssi-last-course', primaryCourse.value.course_id)
  router.push('/')
}

const dateLine = computed(() =>
  new Date()
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(',', ' ·'),
)

const greetingName = computed(() => {
  const full = currentUser.value?.display_name || 'there'
  return full.split(' ')[0]
})

const initials = computed(() => {
  const name = currentUser.value?.display_name || ''
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() || '')
    .join('') || '?'
})

// Streak: count consecutive days back from today that have at least one session
const streakDays = computed(() => {
  if (recentSessions.value.length === 0) return 0
  const dates = new Set(recentSessions.value.map(s => s.started_at.split('T')[0]))
  let streak = 0
  const d = new Date()
  for (let i = 0; i < 14; i++) {
    const key = d.toISOString().split('T')[0]
    if (dates.has(key)) {
      streak++
      d.setDate(d.getDate() - 1)
    } else if (i === 0) {
      // Allow today to be skipped if user hasn't played yet
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }
  return streak
})

const last7Hours = computed<number[]>(() => {
  const out: number[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    const totalSec = recentSessions.value
      .filter(s => s.started_at.split('T')[0] === key)
      .reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
    out.push(Math.round((totalSec / 3600) * 10) / 10)
  }
  return out
})

const hoursThisWeek = computed(() => {
  const sum = last7Hours.value.reduce((a, b) => a + b, 0)
  return Math.round(sum * 10) / 10
})

const avgSessionMins = computed(() => {
  if (recentSessions.value.length === 0) return 0
  const seconds = recentSessions.value.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
  return Math.round((seconds / recentSessions.value.length) / 60)
})

const lastSessionAt = computed(() => recentSessions.value[0]?.started_at || null)

const lastSessionLabel = computed(() => {
  if (!lastSessionAt.value) return 'No sessions yet'
  const last = new Date(lastSessionAt.value)
  const now = new Date()
  const diffMs = now.getTime() - last.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
})

// Second-person ("you're", "your") is only correct for the learner's own
// self-view. This page is admin/teacher-facing ONLY (AdminUserProgress.vue
// is its sole mount point) — isAdminView is true whenever it's live today —
// but the branch stays keyed on isAdminView (default false) so a genuine
// future self-view route gets the learner-voice copy for free.
const streakLine = computed(() => {
  if (isAdminView) {
    if (streakDays.value === 0) return 'No current streak.'
    return `On a ${streakDays.value}-day streak.`
  }
  if (streakDays.value === 0) return "You're back — let's get this streak going."
  return `You're on a ${streakDays.value}-day streak.`
})

const subtitle = computed(() => {
  if (!primaryCourse.value) {
    return isAdminView ? 'Not yet enrolled in a course.' : 'Enrol in a course to start your journey.'
  }
  const remaining = Math.max(0, belt.value.total - belt.value.done)
  const beltLabel = belt.value.next?.name ?? belt.value.current.name
  const parts: string[] = []
  if (isAdminView) {
    parts.push(`Retired ${legosRetired.value} LEGOs in ${primaryCourseName.value}.`)
    parts.push(belt.value.next
      ? `${remaining} more to ${beltLabel} belt.`
      : `Reached ${beltLabel} belt.`)
    if (lastSessionAt.value) parts.push(`Last session ${lastSessionLabel.value}.`)
  } else {
    parts.push(`You've retired ${legosRetired.value} LEGOs in ${primaryCourseName.value}.`)
    parts.push(belt.value.next
      ? `${remaining} more to your ${beltLabel} belt.`
      : `You've reached ${beltLabel} belt — keep going.`)
    if (lastSessionAt.value) parts.push(`Your last session was ${lastSessionLabel.value} — pick up where you left off?`)
  }
  return parts.join(' ')
})

const journeyDone = computed(() => primaryCourse.value?.legos_retired || 0)
const journeyTotal = computed(() => {
  // Best-available proxy: total LEGOs encountered so far. Real total-per-course
  // isn't surfaced by the composables, so we scale the bar against a 60-LEGO
  // target (matches the design's per-course total). If the learner has gone
  // past it, the bar fills.
  const mastered = primaryCourse.value?.legos_mastered || 0
  return Math.max(60, mastered)
})
</script>

<template>
  <div class="progress-page">
    <div v-if="isLoading" class="state-msg schools-subtle">{{ isAdminView ? 'Loading progress…' : 'Loading your progress…' }}</div>

    <div v-else-if="error" class="state-msg schools-subtle">{{ error }}</div>

    <template v-else>
      <div class="grid">
        <!-- LEFT: Greeting + CTA -->
        <section class="left-col">
          <div class="schools-kicker">{{ dateLine }}</div>
          <h1 class="arsenal page-title">
            Demat, {{ greetingName }}.<br />{{ streakLine }}
          </h1>
          <p class="page-sub schools-subtle">{{ subtitle }}</p>

          <div v-if="!isAdminView" class="cta-row">
            <button type="button" class="btn-play" @click="handleKeepGoing">
              ▶ Keep going — LEGO {{ nextLegoNumber }}
            </button>
          </div>

          <div v-if="initials" class="identity-strip">
            <div class="avatar" :style="{ background: `var(--schools-belt-${belt.current.key})` }">
              {{ initials }}
            </div>
            <div class="identity-meta">
              <div class="identity-name">{{ currentUser?.display_name || 'Learner' }}</div>
              <div class="schools-subtle identity-school">
                {{ currentUser?.school_name || '—' }}
              </div>
            </div>
          </div>
        </section>

        <!-- RIGHT: Belt + journey + sparkline cards -->
        <aside class="right-col">
          <div class="schools-card schools-card-pad belt-card">
            <div
              class="belt-orb"
              :style="{ background: `var(--schools-belt-${belt.current.key})` }"
            />
            <div>
              <div class="schools-kicker">Current belt</div>
              <div class="arsenal belt-name">{{ belt.current.name }}</div>
              <div class="schools-subtle belt-note">
                <template v-if="belt.next">
                  {{ Math.max(0, belt.total - belt.done) }} LEGOs to {{ belt.next.name }}
                </template>
                <template v-else>You've reached the top belt</template>
              </div>
            </div>
          </div>

          <div class="schools-card schools-card-pad journey-card">
            <div class="schools-kicker">Your journey</div>
            <JourneyBar
              :done="journeyDone"
              :total="journeyTotal"
              label="LEGOs retired"
            />
            <div class="stat-row">
              <div class="stat">
                <div class="arsenal stat-val">{{ streakDays }}d</div>
                <div class="schools-subtle stat-label">Streak</div>
              </div>
              <div class="stat">
                <div class="arsenal stat-val">{{ hoursThisWeek }}h</div>
                <div class="schools-subtle stat-label">This week</div>
              </div>
              <div class="stat">
                <div class="arsenal stat-val">{{ avgSessionMins }}m</div>
                <div class="schools-subtle stat-label">Avg / day</div>
              </div>
            </div>
          </div>

          <div class="schools-card schools-card-pad spark-card">
            <div class="schools-kicker">Last 7 days</div>
            <Sparkline :data="last7Hours" :width="260" :height="42" />
            <div class="schools-subtle spark-foot">Sun – Sat · hours practised</div>
          </div>
        </aside>
      </div>

      <!-- Course list (only when learner has more than one enrolment) -->
      <section v-if="courses.length > 1" class="schools-card courses-card">
        <div class="courses-head">
          <h3 class="arsenal section-title">All courses</h3>
        </div>
        <table class="ssi-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>LEGOs retired</th>
              <th>Seeds covered</th>
              <th>Practice time</th>
              <th>Last session</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in courses" :key="c.course_id">
              <td>{{ formatCourseName(c.course_id) }}</td>
              <td>{{ c.legos_retired }}</td>
              <td>{{ c.seeds_completed }}</td>
              <td>{{ c.total_practice_minutes }}m</td>
              <td>
                {{
                  c.last_practiced_at
                    ? new Date(c.last_practiced_at).toLocaleDateString('en-GB')
                    : 'Never'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <div v-if="courses.length === 0" class="schools-card schools-card-pad empty-card">
        <h3 class="arsenal section-title">No courses yet</h3>
        <p class="schools-subtle">
          You haven't enrolled in any courses yet. Ask your teacher for a class join code.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.progress-page {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.state-msg {
  padding: 48px 0;
  text-align: center;
  font-size: 14px;
}

.grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 32px;
  align-items: flex-start;
}

/* Left column */
.left-col { display: flex; flex-direction: column; gap: 0; }

.page-title {
  font-size: 48px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin-top: 6px;
}

.page-sub {
  font-size: 15px;
  max-width: 520px;
  margin-top: 14px;
  line-height: 1.55;
}

.cta-row {
  display: flex;
  gap: 10px;
  margin-top: 22px;
  flex-wrap: wrap;
}

.cta-row .btn-play {
  padding: 13px 24px;
  font-size: 15px;
}

.identity-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid var(--schools-border);
}

.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  color: rgba(15, 18, 18, 0.7);
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.15);
  flex: none;
}

.identity-meta { display: flex; flex-direction: column; gap: 2px; }
.identity-name { font-size: 14px; font-weight: 600; color: var(--schools-fg); }
.identity-school { font-size: 12.5px; }

/* Right column */
.right-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.belt-card {
  display: flex;
  align-items: center;
  gap: 16px;
}

.belt-orb {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 3px rgba(0, 0, 0, 0.15);
  flex: none;
}

.belt-name {
  font-size: 26px;
  line-height: 1;
  margin-top: 4px;
}

.belt-note {
  font-size: 12px;
  margin-top: 2px;
}

.journey-card .stat-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}

.stat { text-align: center; flex: 1; }
.stat-val { font-size: 22px; line-height: 1; }
.stat-label { font-size: 11px; margin-top: 2px; }

.spark-card {
  border: 1px dashed var(--schools-border-strong);
  background: #fff;
}
.spark-foot { font-size: 11.5px; margin-top: 6px; }

/* Courses block */
.courses-card { overflow: hidden; }
.courses-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--schools-border);
}
.section-title {
  font-size: 17px;
  margin: 0;
}

.empty-card { text-align: center; padding: 40px 24px; }
.empty-card .section-title { margin-bottom: 6px; }

@media (max-width: 960px) {
  .grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }
  .page-title { font-size: 36px; }
}
</style>
