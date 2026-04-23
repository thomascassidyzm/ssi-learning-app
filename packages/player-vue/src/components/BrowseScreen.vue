<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import { useRouter } from 'vue-router'
import { BELTS, getSharedBeltProgress, getSeedFromLegoId } from '@/composables/useBeltProgress'
import { getLanguageName, getLanguageEndonym, t } from '@/composables/useI18n'
import LanguageFlag from '@/components/schools/shared/LanguageFlag.vue'
import CourseBrowser from '@/components/CourseBrowser.vue'
import { useAuthModal } from '@/composables/useAuthModal'
import { useSharedUserEntitlements } from '@/composables/useUserEntitlements'
import { useSharedSubscription } from '@/composables/useSubscription'
import { useUserRole } from '@/composables/useUserRole'
import { checkCourseAccess, inferPricingTier } from '@ssi/core'

const router = useRouter()

// Entitlement + subscription (same check as CourseSelector)
const { entitlements: userEntitlements } = useSharedUserEntitlements()
const { isSubscribed: hasActiveSubscription } = useSharedSubscription()
const { platformRole, hasSchoolRole } = useUserRole()

const hasFullAccess = (course) => {
  const pricingTier = course.pricing_tier ?? inferPricingTier(course.target_lang ?? '', course.course_code)
  const isCommunity = course.is_community ?? course.course_code?.startsWith('community_')
  const devPaid = (() => {
    try {
      if (sessionStorage.getItem('ssi-demo-tier') === 'paid') return true
      const tier = localStorage.getItem('ssi-dev-tier')
      if (tier === 'paid') return true
      return localStorage.getItem('ssi-dev-paid-user') === 'true'
    } catch { return false }
  })()
  const subscription = {
    isActive: hasActiveSubscription.value || devPaid,
    tier: (hasActiveSubscription.value || devPaid) ? 'paid' : 'free',
  }
  return checkCourseAccess(
    { course_code: course.course_code, pricing_tier: pricingTier, is_community: isCommunity },
    subscription,
    userEntitlements.value,
    platformRole.value
  ).canAccess
}

const isPremiumCourse = (course) => course.pricing_tier === 'premium'

// Auth state for guest banner
const auth = inject('auth')
const isGuest = computed(() => auth?.isGuest?.value ?? true)
const { open: openAuth } = useAuthModal()

// Show schools link for users with a school-scoped educational role.
const hasSchoolsAccess = computed(() => hasSchoolRole.value)

const goToSchools = () => {
  router.push('/schools')
}

const props = defineProps({
  activeCourse: {
    type: Object,
    default: null
  },
  enrolledCourses: {
    type: Array,
    default: () => []
  },
  completedSeeds: {
    type: Number,
    default: 0
  },
  totalSeeds: {
    type: Number,
    default: 668
  },
  currentBeltName: {
    type: String,
    default: 'white'
  },
  totalLearningMinutes: {
    type: Number,
    default: 0
  },
  totalPhrasesSpoken: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['open-belts', 'select-course', 'close', 'start-seed'])

// Inline belt browser toggle
const showBeltBrowser = ref(false)

// Supabase for course fetching
const supabaseRef = inject('supabase', ref(null))

// Belt progress
const beltProgress = computed(() => getSharedBeltProgress())

// Current belt object
const currentBelt = computed(() => {
  return BELTS.find(b => b.name === props.currentBeltName) || BELTS[0]
})

// Current belt index
const currentBeltIndex = computed(() => {
  return BELTS.findIndex(b => b.name === props.currentBeltName)
})

// Next belt (for "N to next" display)
const nextBelt = computed(() => {
  const idx = currentBeltIndex.value
  if (idx < BELTS.length - 1) return BELTS[idx + 1]
  return null
})

// Seeds remaining to next belt
const seedsToNext = computed(() => {
  if (!nextBelt.value) return 0
  return Math.max(0, nextBelt.value.seedsRequired - props.completedSeeds)
})

// Time estimate to next belt (~1 seed/min)
const timeToNext = computed(() => {
  const mins = seedsToNext.value
  if (mins < 60) return `~${mins} min`
  const hours = Math.round(mins / 60)
  return `~${hours} hr`
})

// Format time
const formattedTime = computed(() => {
  const mins = props.totalLearningMinutes
  const hours = Math.floor(mins / 60)
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins % 60}m`
})

// ── Course catalog ──
const allCourses = ref([])
const isLoadingCourses = ref(true)

const fetchCourses = async () => {
  isLoadingCourses.value = true
  const client = supabaseRef.value
  if (!client) {
    isLoadingCourses.value = false
    return
  }

  try {
    const { data, error } = await client
      .from('courses')
      .select('*')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')

    if (error) throw error
    allCourses.value = data || []
  } catch (e) {
    console.error('[BrowseScreen] Failed to fetch courses:', e)
  } finally {
    isLoadingCourses.value = false
  }
}

// Admin check: real user's platform_role from useUserRole.
const isAdmin = computed(() => platformRole.value === 'ssi_admin')

// Course search
const courseSearchQuery = ref('')

const buildSearchString = (course) => {
  return [
    course.display_name || '',
    course.course_code || '',
    getLanguageName(course.target_lang),
    getLanguageName(course.known_lang),
    getLanguageEndonym(course.target_lang),
    getLanguageEndonym(course.known_lang),
  ].join(' ').toLowerCase()
}

// Strip variant suffixes to group dialects together (cym_n → cym, cym_s → cym)
const getBaseLang = (code) => code?.replace(/_(n|s|north|south|latam)$/i, '') || code

const getVariantLabel = (course) => {
  if (course.target_lang?.endsWith('_n')) return 'Northern'
  if (course.target_lang?.endsWith('_s')) return 'Southern'
  if (course.variant_label) return course.variant_label
  const name = course.display_name || ''
  if (name.startsWith('North ')) return 'Northern'
  if (name.startsWith('South ')) return 'Southern'
  if (name.includes('(North)')) return 'Northern'
  if (name.includes('(South)')) return 'Southern'
  if (name.includes('Latin Am')) return 'Latin American'
  return null
}

// All courses — same access check as CourseSelector (entitlements + subscription)
const displayedCourses = computed(() => {
  let courses = allCourses.value.filter(c => !isPremiumCourse(c) || hasFullAccess(c))

  const q = courseSearchQuery.value.trim().toLowerCase()
  if (q) {
    courses = courses.filter(c => buildSearchString(c).includes(q))
  }
  return courses.sort((a, b) => getLanguageName(a.target_lang).localeCompare(getLanguageName(b.target_lang)))
})

// Group by target_lang + known_lang for variant handling
const expandedGroup = ref(null)

const courseGroups = computed(() => {
  const groups = new Map()
  for (const course of displayedCourses.value) {
    const base = getBaseLang(course.target_lang)
    const key = `${base}_${course.known_lang}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        target_lang: base,
        known_lang: course.known_lang,
        name: getLanguageName(base),
        forLabel: getLanguageEndonym(course.known_lang),
        courses: []
      })
    }
    groups.get(key).courses.push(course)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
})

const handleGroupClick = (group) => {
  if (group.courses.length === 1) {
    emit('select-course', group.courses[0])
  } else {
    expandedGroup.value = expandedGroup.value === group.key ? null : group.key
  }
}

// Check if course is enrolled
const isEnrolled = (courseCode) => {
  return props.enrolledCourses.some(e => e.course_code === courseCode || e.course_id === courseCode)
}

// Check if course is currently active
const isActiveCourse = (courseCode) => {
  return props.activeCourse?.course_code === courseCode
}

// Get full course display name in the known language
// e.g., "Euskera para hablantes de Español" (for spa known lang)
const getFullDisplayName = (course) => {
  const target = getLanguageName(course.target_lang)
  const known = getLanguageName(course.known_lang)
  const forSpeakers = t('courseSelector.forSpeakers', `for ${known} Speakers`).replace('{lang}', known)
  return `${target} ${forSpeakers}`
}

// Get enrollment progress
const getProgress = (courseCode) => {
  const enrollment = props.enrolledCourses.find(e => e.course_code === courseCode || e.course_id === courseCode)
  if (!enrollment) return 0
  return enrollment.progress || Math.round((enrollment.completed_seeds || 0) / (enrollment.total_seeds || 668) * 100)
}

onMounted(() => {
  fetchCourses()
})
</script>

<template>
  <div class="browse-screen">
    <!-- Header -->
    <div class="browse-header">
      <div class="header-spacer" />
      <h1 class="browse-title">Library</h1>
      <button class="close-btn" @click="emit('close')" aria-label="Close library">&#x2715;</button>
    </div>

    <div class="browse-content">
      <!-- ── Guest auth banner ── -->
      <div v-if="isGuest" class="guest-auth-banner" @click="emit('close'); openAuth()">
        <div class="guest-auth-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div class="guest-auth-text">
          <span class="guest-auth-title">Your progress is fragile</span>
          <span class="guest-auth-subtitle">Sign in to save it</span>
        </div>
        <svg class="guest-auth-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>

      <!-- ── Schools Dashboard Link (teachers/admins) ── -->
      <button v-if="hasSchoolsAccess" class="schools-link" @click="goToSchools">
        <div class="schools-link-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </div>
        <div class="schools-link-text">
          <span class="schools-link-title">Schools Dashboard</span>
          <span class="schools-link-subtitle">Classes, students & analytics</span>
        </div>
        <svg class="schools-link-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      <!-- ── Section 1: Progress Strip ── -->
      <section class="section">
        <h3 class="section-label">Your Progress</h3>
        <div class="progress-card" @click="showBeltBrowser = !showBeltBrowser">
          <!-- Belt strip: 8 colored dots -->
          <div class="belt-strip">
            <div
              v-for="(belt, i) in BELTS"
              :key="belt.name"
              class="belt-pip"
              :class="{
                completed: i < currentBeltIndex,
                current: i === currentBeltIndex,
                future: i > currentBeltIndex,
              }"
              :style="{ background: i <= currentBeltIndex ? belt.color : undefined }"
            >
              <!-- Checkmark for completed belts -->
              <svg v-if="i < currentBeltIndex" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
          </div>

          <!-- Belt label + progress -->
          <div class="progress-meta">
            <span class="progress-belt-name" :style="{ color: currentBelt.color }">
              {{ currentBelt.name }} Belt
            </span>
            <span v-if="nextBelt" class="progress-to-next">
              {{ timeToNext }} to {{ nextBelt.name }}
            </span>
            <span v-else class="progress-to-next">
              {{ completedSeeds }} / {{ totalSeeds }} seeds
            </span>
          </div>

          <!-- Chevron -->
          <div class="card-action">
            <span class="card-action-label">View Belts</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- Inline Belt Browser (expanded below progress card) -->
      <Transition name="expand">
        <div v-if="showBeltBrowser" class="belt-browser-inline">
          <CourseBrowser
            @start-seed="(s) => emit('start-seed', s)"
            @close="showBeltBrowser = false"
          />
        </div>
      </Transition>


      <!-- ── Section 3: Activity ── -->
      <section class="section">
        <h3 class="section-label">Activity</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="stat-value">{{ formattedTime }}</div>
            <div class="stat-label">Total Time</div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </div>
            <div class="stat-value">{{ completedSeeds }}</div>
            <div class="stat-label">Words</div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              </svg>
            </div>
            <div class="stat-value">{{ totalPhrasesSpoken }}</div>
            <div class="stat-label">Phrases</div>
          </div>
        </div>
      </section>

      <!-- ── Section 4: All Courses ── -->
      <section class="section">
        <h3 class="section-label">All Courses</h3>

        <!-- Search -->
        <input
          v-model="courseSearchQuery"
          type="text"
          class="course-search-input"
          placeholder="Search any language..."
          autocomplete="off"
        />

        <!-- Loading state -->
        <div v-if="isLoadingCourses" class="courses-loading">
          <div class="loading-spinner"></div>
        </div>

        <!-- No results -->
        <div v-else-if="courseGroups.length === 0 && courseSearchQuery.trim()" class="no-results">
          No courses matching "{{ courseSearchQuery }}"
        </div>

        <!-- Course grid -->
        <div v-else class="course-grid">
          <template v-for="group in courseGroups" :key="group.key">
            <!-- Single course -->
            <template v-if="group.courses.length === 1">
              <button
                class="course-card"
                :class="{ active: isActiveCourse(group.courses[0].course_code) }"
                @click="emit('select-course', group.courses[0])"
              >
                <div v-if="isActiveCourse(group.courses[0].course_code)" class="course-badge active-badge">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                  </svg>
                </div>
                <div v-else-if="group.courses[0].new_app_status === 'beta'" class="course-badge beta-badge">β</div>

                <LanguageFlag :code="group.courses[0].target_lang" :size="18" />
                <span class="course-name">{{ group.name }}</span>
                <span class="course-for">for {{ group.forLabel }} speakers</span>

                <span class="course-status">
                  <template v-if="isEnrolled(group.courses[0].course_code)">
                    {{ getProgress(group.courses[0].course_code) }}%
                  </template>
                </span>
              </button>
            </template>

            <!-- Multiple variants -->
            <template v-else>
              <button
                class="course-card has-variants"
                :class="{
                  expanded: expandedGroup === group.key,
                  active: group.courses.some(c => isActiveCourse(c.course_code))
                }"
                @click="handleGroupClick(group)"
              >
                <LanguageFlag :code="group.target_lang" :size="18" />
                <span class="course-name">{{ group.name }}</span>
                <span class="course-for">for {{ group.forLabel }} speakers</span>
                <span class="course-status variant-count">{{ group.courses.length }} variants ▾</span>
              </button>

              <!-- Variant sub-cards -->
              <div v-if="expandedGroup === group.key" class="variant-list">
                <button
                  v-for="course in group.courses"
                  :key="course.course_code"
                  class="variant-card"
                  :class="{ active: isActiveCourse(course.course_code) }"
                  @click="emit('select-course', course)"
                >
                  <span class="variant-name">{{ getVariantLabel(course) || course.display_name }}</span>
                  <span v-if="isEnrolled(course.course_code)" class="course-status">{{ getProgress(course.course_code) }}%</span>
                </button>
              </div>
            </template>
          </template>
        </div>
      </section>
    </div>

    <!-- Bottom safe area -->
    <div class="safe-area"></div>
  </div>
</template>

<style scoped>
.browse-screen {
  color: var(--text-primary);
  font-family: var(--font-body);
  overflow-y: auto;
  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

/* Header */
.browse-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--border-subtle);
}

.header-spacer {
  width: 2rem;
}

.browse-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
  text-align: center;
  flex: 1;
}

.close-btn {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1rem;
  cursor: pointer;
  border-radius: 50%;
  transition: color 0.2s, background 0.2s;
}

.close-btn:hover {
  color: var(--text-primary);
  background: var(--bg-secondary, rgba(255,255,255,0.08));
}

/* Content */
.browse-content {
  position: relative;
  z-index: 10;
  padding: 0.75rem 1.5rem 0;
}

/* Section */
.section {
  margin-bottom: 1.5rem;
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0.25rem;
}

/* ── Progress Card ── */
.progress-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem 1.25rem;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.progress-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
}

.progress-card:active {
  transform: scale(0.99);
}

/* Belt strip */
.belt-strip {
  display: flex;
  gap: 6px;
  margin-bottom: 0.75rem;
}

.belt-pip {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.belt-pip.completed {
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.1);
}

.belt-pip.completed svg {
  width: 14px;
  height: 14px;
  color: #000;
}

.belt-pip.current {
  box-shadow: 0 0 0 2px var(--bg-card), 0 0 0 4px currentColor;
  position: relative;
}

.belt-pip.future {
  background: var(--bg-elevated) !important;
  opacity: 0.4;
}

/* Progress meta */
.progress-meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.progress-belt-name {
  font-size: 0.9375rem;
  font-weight: 600;
  text-transform: capitalize;
}

.progress-to-next {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

/* Shared card action row */
.card-action {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
}

.card-action-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--accent);
}

.card-action svg {
  width: 16px;
  height: 16px;
  color: var(--accent);
}

/* ── Stats Grid ── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 0.875rem 0.75rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.375rem;
}

.stat-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-glow);
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon svg {
  width: 16px;
  height: 16px;
  color: var(--accent);
}

.stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-label {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

/* ── Course Grid ── */
.courses-loading {
  display: flex;
  justify-content: center;
  padding: 2rem 0;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.course-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}

.course-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
  color: var(--text-primary);
  text-align: center;
  -webkit-tap-highlight-color: transparent;
}

.course-card:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
}

.course-card:active {
  transform: scale(0.98);
}

.course-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow, rgba(194, 58, 58, 0.15));
}

.course-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 0.5625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  line-height: 1.2;
}

.course-badge.active-badge {
  background: var(--accent);
  color: #fff;
  padding: 0.125rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
}

.course-badge.active-badge svg {
  width: 10px;
  height: 10px;
}

.course-badge.beta-badge {
  background: linear-gradient(135deg, #8b5cf6, #a78bfa);
  color: #fff;
}

.course-badge.new-badge {
  background: var(--accent);
  color: #fff;
}

.course-flag {
  line-height: 1;
}

.course-name {
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.2;
}

.course-for {
  font-size: 0.5625rem;
  color: var(--text-muted);
  line-height: 1;
}

.course-status {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.variant-count {
  font-size: 0.625rem;
}

.course-card.has-variants {
  border-style: dashed;
}

.course-card.has-variants.expanded {
  border-color: var(--ssi-red);
  border-style: solid;
}

.variant-list {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.variant-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.625rem 0.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
}

.variant-card:hover {
  border-color: var(--ssi-red);
}

.variant-card.active {
  border-color: var(--ssi-red);
  background: rgba(194, 58, 58, 0.08);
}

.variant-name {
  font-size: 0.8125rem;
  font-weight: 600;
}

.course-search-input {
  width: 100%;
  padding: 0.625rem 0.75rem;
  margin-bottom: 0.75rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  font-size: 0.875rem;
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s ease;
}

.course-search-input::placeholder {
  color: var(--text-muted);
}

.course-search-input:focus {
  border-color: var(--ssi-red);
}

.no-results {
  text-align: center;
  padding: 1.5rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}

/* ── Inline Belt Browser ── */
.belt-browser-inline {
  margin-bottom: 1.5rem;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
}

/* Expand transition */
.expand-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.expand-leave-active {
  transition: all 0.2s ease-in;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  margin-bottom: 0;
}

/* Safe area */
.safe-area {
  height: 2rem;
  flex-shrink: 0;
}

/* ── Tablet (768px+) ── */
@media (min-width: 768px) {
  .browse-content {
    max-width: 600px;
    margin: 0 auto;
    padding: 0 2rem;
  }

  .course-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* Schools Dashboard Link */
/* Guest auth banner */
.guest-auth-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3, 0.75rem);
  width: 100%;
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  margin-bottom: var(--space-4, 1rem);
  background: rgba(194, 58, 58, 0.08);
  border: 1px solid rgba(194, 58, 58, 0.2);
  border-radius: var(--radius-lg, 12px);
  cursor: pointer;
  transition: all 0.2s ease;
}

.guest-auth-banner:hover {
  background: rgba(194, 58, 58, 0.12);
  border-color: rgba(194, 58, 58, 0.3);
}

.guest-auth-banner:active {
  transform: scale(0.98);
}

.guest-auth-icon {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.guest-auth-icon svg {
  width: 22px;
  height: 22px;
  color: var(--ssi-red, #c23a3a);
}

.guest-auth-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.guest-auth-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.guest-auth-subtitle {
  font-size: 0.75rem;
  color: var(--text-secondary, rgba(255,255,255,0.6));
}

.guest-auth-arrow {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--text-muted, rgba(255,255,255,0.3));
}

.schools-link {
  display: flex;
  align-items: center;
  gap: var(--space-4, 1rem);
  width: 100%;
  padding: var(--space-4, 1rem) var(--space-5, 1.25rem);
  margin-bottom: var(--space-6, 1.5rem);
  background: var(--bg-card, rgba(255,255,255,0.06));
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.1));
  border-radius: var(--radius-lg, 12px);
  color: var(--text-primary, #fff);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  text-align: left;
  font-family: inherit;
}

.schools-link:hover {
  background: var(--bg-elevated, rgba(255,255,255,0.1));
  border-color: var(--ssi-gold, #d4a843);
}

.schools-link-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  color: var(--ssi-gold, #d4a843);
}

.schools-link-icon svg {
  width: 100%;
  height: 100%;
}

.schools-link-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.schools-link-title {
  font-size: var(--text-base, 1rem);
  font-weight: var(--font-semibold, 600);
}

.schools-link-subtitle {
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-muted, rgba(255,255,255,0.5));
}

.schools-link-arrow {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  color: var(--text-muted, rgba(255,255,255,0.5));
}
</style>

<!-- Belt pip future needs !important to override inline style attribute -->
<style>
:root[data-theme="mist"] .browse-screen .browse-header {
  background: #ffffff;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 4px rgba(44, 38, 34, 0.12);
}

:root[data-theme="mist"] .browse-screen .belt-pip.future {
  background: var(--bg-elevated) !important;
}
</style>
