<script setup>
/**
 * CourseSelector - Bottom sheet for course selection
 *
 * Features:
 * - "I speak" pills for known language selection (enables language chaining)
 * - "I want to learn" grid of target languages
 * - Shows progress for enrolled courses, "NEW" badge for unenrolled
 * - Queries Supabase for available courses (uses dashboard schema as SSoT)
 * - Filters by new_app_status field: draft (hidden), beta (visible with badge), live (visible)
 * - Shows pricing_tier indicator for premium courses
 * - Localized UI based on selected known language
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n, setLocale, getLanguageName, getLanguageFlag } from '../composables/useI18n'
import { useSharedUserEntitlements } from '../composables/useUserEntitlements'
import { useSharedSubscription } from '../composables/useSubscription'
import { checkCourseAccess, inferPricingTier } from '@ssi/core'

const { t } = useI18n()

// Entitlement + subscription singletons (initialized by App.vue)
const { entitlements: userEntitlements } = useSharedUserEntitlements()
const { isSubscribed: hasActiveSubscription } = useSharedSubscription()

// Check if user has full access to a course (not just preview)
const hasFullAccess = (course) => {
  const pricingTier = course.pricing_tier ?? inferPricingTier(course.target_lang ?? '', course.course_code)
  const isCommunity = course.is_community ?? course.course_code?.startsWith('community_')
  // Dev flag override
  const devPaid = (() => {
    try {
      const tier = localStorage.getItem('ssi-dev-tier')
      if (tier === 'paid') return true
      return localStorage.getItem('ssi-dev-paid-user') === 'true'
    } catch { return false }
  })()
  const subscription = {
    isActive: hasActiveSubscription.value || devPaid,
    tier: (hasActiveSubscription.value || devPaid) ? 'paid' : 'free',
  }
  const result = checkCourseAccess(
    { course_code: course.course_code, pricing_tier: pricingTier, is_community: isCommunity },
    subscription,
    userEntitlements.value
  )
  return result.canAccess
}

// Check if course is premium (for "Free preview" indicator)
const isPremiumCourse = (course) => {
  return course.pricing_tier === 'premium'
}

// Check if course has beta status
const isBetaCourse = (course) => {
  return course.new_app_status === 'beta'
}

// Extract target language name from display_name or fall back to locale lookup
// e.g., "Welsh (North) for English Speakers" → "Welsh (North)"
// Detects raw code display_names like "ARA FOR ENG" and falls back to locale
const getTargetDisplayName = (course) => {
  if (course.display_name) {
    const match = course.display_name.match(/^(.+?)\s+for\s+/i)
    if (match && !/^[a-z]{2,3}$/i.test(match[1].trim())) return match[1]
  }
  return getLanguageName(course.target_lang)
}

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  supabase: {
    type: Object,
    default: null
  },
  enrolledCourses: {
    type: Array,
    default: () => []
  },
  activeCourseId: {
    type: String,
    default: null
  },
  defaultKnownLang: {
    type: String,
    default: 'eng'  // 3-letter code
  },
  isAdmin: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'selectCourse'])

// State
const selectedKnownLang = ref(props.defaultKnownLang)
const allCourses = ref([])
const isLoading = ref(false)
const error = ref(null)
const langSearchQuery = ref('')
const langSearchFocused = ref(false)

// Top 4 most popular known languages (hardcoded for now, could be dynamic later)
const TOP_KNOWN_LANGS = ['eng', 'zho', 'jpn', 'spa']

// Computed: unique known languages from courses
const knownLanguages = computed(() => {
  const langMap = new Map()
  for (const course of allCourses.value) {
    if (!langMap.has(course.known_lang)) {
      langMap.set(course.known_lang, {
        code: course.known_lang,
        name: getLanguageName(course.known_lang)
      })
    }
  }
  return [...langMap.values()].sort((a, b) => a.name.localeCompare(b.name))
})

// Split into top languages and others
const topLanguages = computed(() => {
  return TOP_KNOWN_LANGS
    .map(code => knownLanguages.value.find(l => l.code === code))
    .filter(Boolean)
})

const otherLanguages = computed(() => {
  return knownLanguages.value.filter(l => !TOP_KNOWN_LANGS.includes(l.code))
})

const filteredOtherLanguages = computed(() => {
  const q = langSearchQuery.value.toLowerCase().trim()
  if (!q) return otherLanguages.value
  return otherLanguages.value.filter(l => l.name.toLowerCase().includes(q))
})

// Computed: courses available for selected known language
// TODO: Re-add entitlement gating once entitlements are fully wired up
const availableCourses = computed(() => {
  return allCourses.value
    .filter(c => c.known_lang === selectedKnownLang.value)
    .sort((a, b) => {
      const nameA = getLanguageName(a.target_lang)
      const nameB = getLanguageName(b.target_lang)
      return nameA.localeCompare(nameB)
    })
})

// Update locale when known language changes
watch(selectedKnownLang, (newLang) => {
  setLocale(newLang)
})

// Check if a course is enrolled
const isEnrolled = (courseCode) => {
  return props.enrolledCourses.some(e => e.course_code === courseCode || e.course_id === courseCode)
}

// Get enrollment data for a course
const getEnrollment = (courseCode) => {
  return props.enrolledCourses.find(e => e.course_code === courseCode || e.course_id === courseCode)
}

// Get progress for a course
const getProgress = (courseCode) => {
  const enrollment = getEnrollment(courseCode)
  if (!enrollment) return 0
  return enrollment.progress || Math.round((enrollment.completed_seeds || 0) / (enrollment.total_seeds || 668) * 100)
}

// Check if course is currently active
const isActive = (courseCode) => {
  return props.activeCourseId === courseCode
}

// Fetch courses from Supabase (dashboard schema is SSoT)
const fetchCourses = async () => {
  isLoading.value = true
  error.value = null

  // If no Supabase client, use mock data (demo mode)
  if (!props.supabase) {
    console.log('[CourseSelector] No Supabase client, using mock data')
    allCourses.value = getMockCourses()
    isLoading.value = false
    return
  }

  try {
    const { data, error: fetchError } = await props.supabase
      .from('courses')
      .select('*')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')

    if (fetchError) throw fetchError
    allCourses.value = data || []
  } catch (e) {
    console.error('Failed to fetch courses:', e)
    error.value = 'Failed to load courses'
    allCourses.value = []
  } finally {
    isLoading.value = false
  }
}

// Handle course selection
const handleCourseSelect = (course) => {
  // Haptic feedback
  if (navigator.vibrate) {
    navigator.vibrate(10)
  }
  emit('selectCourse', course)
}

// Watch for prop changes
watch(() => props.defaultKnownLang, (newVal) => {
  selectedKnownLang.value = newVal
})

watch(() => props.isOpen, (newVal) => {
  if (newVal && allCourses.value.length === 0) {
    fetchCourses()
  }
})

// Initial load
onMounted(() => {
  if (props.isOpen) {
    fetchCourses()
  }
})
</script>

<template>
  <Transition name="slide-up">
    <div v-if="isOpen" class="selector-overlay" @click.self="emit('close')">
      <div class="selector-panel">
        <div class="course-selector">
          <!-- Header -->
          <header class="sheet-header">
            <div class="header-spacer" />
            <h2 class="sheet-title">{{ t('courseSelector.title') }}</h2>
            <button class="close-btn" @click="emit('close')" aria-label="Close">&#x2715;</button>
          </header>

          <!-- Loading state -->
          <div v-if="isLoading" class="loading-state">
            <div class="loading-spinner"></div>
            <span>Loading courses...</span>
          </div>

          <!-- Error state -->
          <div v-else-if="error" class="error-state">
            <span>{{ error }}</span>
            <button @click="fetchCourses">Retry</button>
          </div>

          <!-- Content -->
          <div v-else class="sheet-content">
          <!-- Known Language Selector -->
          <section class="section">
            <h3 class="section-label">{{ t('courseSelector.iSpeak') }}</h3>

            <!-- Top 4 language buttons -->
            <div class="top-lang-grid">
              <button
                v-for="lang in topLanguages"
                :key="lang.code"
                class="top-lang-btn"
                :class="{ active: selectedKnownLang === lang.code }"
                @click="selectedKnownLang = lang.code; langSearchQuery = ''"
              >
                {{ lang.name }}
              </button>
            </div>

            <!-- Search for other languages -->
            <div v-if="otherLanguages.length > 0" class="lang-search-section">
              <input
                v-model="langSearchQuery"
                type="text"
                class="lang-search-input"
                placeholder="Search other languages..."
                @focus="langSearchFocused = true"
                @blur="setTimeout(() => langSearchFocused = false, 200)"
              />
              <div v-if="filteredOtherLanguages.length > 0 && (langSearchFocused || langSearchQuery.trim())" class="language-pills">
                <button
                  v-for="lang in filteredOtherLanguages"
                  :key="lang.code"
                  class="language-pill"
                  :class="{ active: selectedKnownLang === lang.code }"
                  @click="selectedKnownLang = lang.code; langSearchQuery = ''"
                >
                  <span class="pill-name">{{ lang.name }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- Target Language Grid -->
          <section class="section">
            <h3 class="section-label">{{ t('courseSelector.iWantToLearn') }}</h3>
            <div class="target-grid">
              <button
                v-for="course in availableCourses"
                :key="course.course_code"
                class="target-card"
                :class="{
                  enrolled: isEnrolled(course.course_code),
                  active: isActive(course.course_code)
                }"
                @click="handleCourseSelect(course)"
              >
                <!-- Active indicator -->
                <div v-if="isActive(course.course_code)" class="active-badge">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                  </svg>
                </div>

                <!-- Beta badge for beta courses -->
                <div v-else-if="isBetaCourse(course)" class="beta-badge">β</div>

                <!-- NEW badge for unenrolled released courses -->
                <div v-else-if="!isEnrolled(course.course_code)" class="new-badge">{{ t('courseSelector.new') }}</div>

                <span class="target-flag">{{ getLanguageFlag(course.target_lang) }}</span>
                <span class="target-name">{{ getTargetDisplayName(course) }}</span>

                <!-- Progress or status -->
                <span class="target-status" :class="{ 'preview-status': isPremiumCourse(course) && !hasFullAccess(course) }">
                  <template v-if="isEnrolled(course.course_code)">
                    {{ getProgress(course.course_code) }}%
                  </template>
                  <template v-else-if="isPremiumCourse(course) && !hasFullAccess(course)">
                    Free preview
                  </template>
                  <template v-else>
                    {{ t('courseSelector.ready') }}
                  </template>
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
  </Transition>
</template>

<style scoped>
/* Fonts loaded globally in style.css */

.selector-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.selector-panel {
  width: 100%;
  max-width: 500px;
  max-height: 100dvh;
  overflow-y: auto;
  background: var(--bg-primary);
  border-radius: 16px 16px 0 0;
  overscroll-behavior: contain;
}

/* Slide up transition */
.slide-up-enter-active {
  transition: opacity 0.3s ease;
}

.slide-up-enter-active .selector-panel {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-leave-active {
  transition: opacity 0.25s ease-in;
}

.slide-up-leave-active .selector-panel {
  transition: transform 0.2s ease-in;
}

.slide-up-enter-from {
  opacity: 0;
}

.slide-up-enter-from .selector-panel {
  transform: translateY(100%);
}

.slide-up-leave-to {
  opacity: 0;
}

.slide-up-leave-to .selector-panel {
  transform: translateY(100%);
}

.course-selector {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.sheet-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  flex-shrink: 0;
  background: linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--border-subtle);
}

.header-spacer {
  width: 2rem;
}

.sheet-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
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

/* Loading & Error states */
.loading-state,
.error-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1.5rem;
  gap: 1rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.45));
  font-family: var(--font-body);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  border-top-color: var(--accent, #c23a3a);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state button {
  padding: 0.5rem 1rem;
  background: var(--accent, #c23a3a);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}

/* Content */
.sheet-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1.5rem 2rem;
  padding-bottom: calc(6rem + env(safe-area-inset-bottom, 0px));
  -webkit-overflow-scrolling: touch;
}

.section {
  margin-bottom: 1.5rem;
}

.section-label {
  font-family: var(--font-body);
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted, rgba(255, 255, 255, 0.45));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0;
}

/* Top Language Grid (2x2) */
.top-lang-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.top-lang-btn {
  padding: 0.75rem 1rem;
  background: var(--bg-card, rgba(255, 255, 255, 0.04));
  border: 1.5px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
}

.top-lang-btn:hover {
  background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
  border-color: var(--border-medium, rgba(255, 255, 255, 0.12));
}

.top-lang-btn.active {
  background: rgba(194, 58, 58, 0.15);
  border-color: rgba(194, 58, 58, 0.4);
  color: var(--accent, #c23a3a);
}

/* Language Search */
.lang-search-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.lang-search-input {
  width: 100%;
  padding: 0.625rem 1rem;
  background: var(--bg-card, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  border-radius: 10px;
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--text-primary, #f5f5f5);
  outline: none;
  transition: border-color 0.2s ease;
  box-sizing: border-box;
}

.lang-search-input::placeholder {
  color: var(--text-muted, rgba(255, 255, 255, 0.35));
}

.lang-search-input:focus {
  border-color: var(--border-medium, rgba(255, 255, 255, 0.2));
}

/* Language Pills */
.language-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.language-pill {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: var(--bg-card, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  border-radius: 100px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.language-pill:hover {
  background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
  border-color: var(--border-medium, rgba(255, 255, 255, 0.12));
}

.language-pill.active {
  background: rgba(194, 58, 58, 0.15);
  border-color: rgba(194, 58, 58, 0.4);
}

.pill-name {
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
}

.language-pill.active .pill-name {
  color: var(--accent, #c23a3a);
  font-weight: 600;
}

/* Target Grid */
.target-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.target-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  padding: 1rem 0.5rem;
  background: var(--bg-card, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
}

.target-card:hover {
  background: var(--bg-elevated, rgba(255, 255, 255, 0.06));
  border-color: var(--border-medium, rgba(255, 255, 255, 0.12));
  transform: translateY(-2px);
}

.target-card:active {
  transform: scale(0.98);
}

.target-card.enrolled {
  background: rgba(74, 222, 128, 0.08);
  border-color: rgba(74, 222, 128, 0.2);
}

.target-card.active {
  background: rgba(194, 58, 58, 0.12);
  border-color: rgba(194, 58, 58, 0.4);
  box-shadow: 0 0 20px rgba(194, 58, 58, 0.15);
}

.active-badge {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 20px;
  height: 20px;
  background: var(--accent, #c23a3a);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.active-badge svg {
  width: 12px;
  height: 12px;
  color: white;
}

.new-badge {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  padding: 0.125rem 0.375rem;
  background: linear-gradient(135deg, #ff9500 0%, #ffb340 100%);
  border-radius: 4px;
  font-family: var(--font-body);
  font-size: 0.5625rem;
  font-weight: 700;
  color: white;
  letter-spacing: 0.03em;
}

.beta-badge {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  padding: 0.0625rem 0.25rem;
  background: rgba(139, 92, 246, 0.25);
  border: 1px solid rgba(139, 92, 246, 0.4);
  border-radius: 3px;
  font-family: 'Space Mono', monospace;
  font-size: 0.5rem;
  font-weight: 400;
  color: rgba(167, 139, 250, 0.8);
  letter-spacing: 0.05em;
}

.target-flag {
  font-size: 1.5rem;
  line-height: 1;
}

.target-name {
  font-family: var(--font-body);
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary, #f5f5f5);
  text-align: center;
  line-height: 1.3;
}

.target-status {
  font-family: 'Space Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.45));
}

.target-card.enrolled .target-status {
  color: #4ade80;
}

.target-card.active .target-status {
  color: var(--accent, #c23a3a);
}

.target-status.preview-status {
  color: #ffb340;
  font-family: var(--font-body);
  font-size: 0.625rem;
  font-weight: 600;
}

/* Responsive */
@media (max-width: 400px) {
  .target-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 500px) {
  .target-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>

<!-- Mist theme: paper surfaces instead of glass -->
<style>
:root[data-theme="mist"] .selector-panel {
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  border-right: 1px solid rgba(0, 0, 0, 0.08);
}

@media (max-width: 539px) {
  :root[data-theme="mist"] .selector-panel {
    border-left: none;
    border-right: none;
  }
}

:root[data-theme="mist"] .course-selector .sheet-header {
  background: #ffffff;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 4px rgba(44, 38, 34, 0.12);
}
</style>
