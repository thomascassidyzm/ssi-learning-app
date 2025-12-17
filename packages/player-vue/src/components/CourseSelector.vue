<script setup>
/**
 * CourseSelector - Bottom sheet for course selection
 *
 * Features:
 * - "I speak" pills for known language selection (enables language chaining)
 * - "I want to learn" grid of target languages
 * - Shows progress for enrolled courses, "NEW" badge for unenrolled
 * - Queries Supabase for available courses (uses dashboard schema as SSoT)
 */
import { ref, computed, watch, onMounted } from 'vue'

// Language metadata mapping (3-letter codes to display info)
const LANGUAGE_META = {
  eng: { name: 'English', flag: '🇬🇧' },
  spa: { name: 'Spanish', flag: '🇪🇸' },
  ita: { name: 'Italian', flag: '🇮🇹' },
  fra: { name: 'French', flag: '🇫🇷' },
  deu: { name: 'German', flag: '🇩🇪' },
  por: { name: 'Portuguese', flag: '🇵🇹' },
  cym: { name: 'Welsh', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  jpn: { name: 'Japanese', flag: '🇯🇵' },
  zho: { name: 'Chinese', flag: '🇨🇳' },
  kor: { name: 'Korean', flag: '🇰🇷' },
  ara: { name: 'Arabic', flag: '🇸🇦' },
  nld: { name: 'Dutch', flag: '🇳🇱' },
  rus: { name: 'Russian', flag: '🇷🇺' },
  pol: { name: 'Polish', flag: '🇵🇱' },
}

const getLangMeta = (code) => LANGUAGE_META[code] || { name: code.toUpperCase(), flag: '🌐' }

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
  }
})

const emit = defineEmits(['close', 'selectCourse'])

// State
const selectedKnownLang = ref(props.defaultKnownLang)
const allCourses = ref([])
const isLoading = ref(true)
const error = ref(null)

// Computed: unique known languages from courses
const knownLanguages = computed(() => {
  const langMap = new Map()
  for (const course of allCourses.value) {
    if (!langMap.has(course.known_lang)) {
      const meta = getLangMeta(course.known_lang)
      langMap.set(course.known_lang, {
        code: course.known_lang,
        name: meta.name,
        flag: meta.flag
      })
    }
  }
  // Sort with English first, then alphabetically
  return [...langMap.values()].sort((a, b) => {
    if (a.code === 'eng') return -1
    if (b.code === 'eng') return 1
    return a.name.localeCompare(b.name)
  })
})

// Computed: courses available for selected known language
const availableCourses = computed(() => {
  return allCourses.value
    .filter(c => c.known_lang === selectedKnownLang.value)
    .sort((a, b) => {
      const nameA = getLangMeta(a.target_lang).name
      const nameB = getLangMeta(b.target_lang).name
      return nameA.localeCompare(nameB)
    })
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
      .order('display_name')

    if (fetchError) throw fetchError
    allCourses.value = data || []
    console.log('[CourseSelector] Loaded courses from Supabase:', data?.length || 0)
  } catch (e) {
    console.error('Failed to fetch courses:', e)
    error.value = 'Failed to load courses'
    // Fallback to mock data for development
    allCourses.value = getMockCourses()
  } finally {
    isLoading.value = false
  }
}

// Mock courses for development/fallback (matches dashboard schema)
const getMockCourses = () => [
  { course_code: 'spa_for_eng', known_lang: 'eng', target_lang: 'spa', display_name: 'Spanish for English Speakers', status: 'active' },
  { course_code: 'ita_for_eng', known_lang: 'eng', target_lang: 'ita', display_name: 'Italian for English Speakers', status: 'active' },
  { course_code: 'fra_for_eng', known_lang: 'eng', target_lang: 'fra', display_name: 'French for English Speakers', status: 'active' },
  { course_code: 'deu_for_eng', known_lang: 'eng', target_lang: 'deu', display_name: 'German for English Speakers', status: 'active' },
  { course_code: 'cym_for_eng', known_lang: 'eng', target_lang: 'cym', display_name: 'Welsh for English Speakers', status: 'active' },
  { course_code: 'por_for_eng', known_lang: 'eng', target_lang: 'por', display_name: 'Portuguese for English Speakers', status: 'active' },
  { course_code: 'jpn_for_eng', known_lang: 'eng', target_lang: 'jpn', display_name: 'Japanese for English Speakers', status: 'draft' },
  { course_code: 'zho_for_eng', known_lang: 'eng', target_lang: 'zho', display_name: 'Chinese for English Speakers', status: 'draft' },
  // Language chaining from Spanish
  { course_code: 'ita_for_spa', known_lang: 'spa', target_lang: 'ita', display_name: 'Italian para hispanohablantes', status: 'draft' },
  { course_code: 'fra_for_spa', known_lang: 'spa', target_lang: 'fra', display_name: 'French para hispanohablantes', status: 'draft' },
  { course_code: 'eng_for_spa', known_lang: 'spa', target_lang: 'eng', display_name: 'English para hispanohablantes', status: 'draft' },
  // From German
  { course_code: 'spa_for_deu', known_lang: 'deu', target_lang: 'spa', display_name: 'Spanish for German Speakers', status: 'draft' },
]

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
  <Transition name="sheet">
    <div v-if="isOpen" class="course-selector-overlay" @click="emit('close')">
      <div class="course-selector-sheet" @click.stop>
        <!-- Drag handle -->
        <div class="sheet-handle"></div>

        <!-- Header -->
        <header class="sheet-header">
          <h2 class="sheet-title">Choose Your Course</h2>
          <button class="close-btn" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
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
            <h3 class="section-label">I speak</h3>
            <div class="language-pills-container">
              <div class="language-pills">
                <button
                  v-for="lang in knownLanguages"
                  :key="lang.code"
                  class="language-pill"
                  :class="{ active: selectedKnownLang === lang.code }"
                  @click="selectedKnownLang = lang.code"
                >
                  <span class="pill-flag">{{ lang.flag }}</span>
                  <span class="pill-name">{{ lang.name }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- Target Language Grid -->
          <section class="section">
            <h3 class="section-label">I want to learn</h3>
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

                <!-- NEW badge for unenrolled -->
                <div v-else-if="!isEnrolled(course.course_code)" class="new-badge">NEW</div>

                <span class="target-flag">{{ getLangMeta(course.target_lang).flag }}</span>
                <span class="target-name">{{ getLangMeta(course.target_lang).name }}</span>

                <!-- Progress or status -->
                <span class="target-status">
                  <template v-if="isEnrolled(course.course_code)">
                    {{ getProgress(course.course_code) }}%
                  </template>
                  <template v-else>
                    {{ course.status === 'active' ? 'Ready' : 'Coming soon' }}
                  </template>
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.course-selector-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay, rgba(0, 0, 0, 0.6));
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.course-selector-sheet {
  width: 100%;
  max-width: 500px;
  max-height: 85vh;
  background: var(--bg-secondary, #0d0d12);
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  border-bottom: none;
  border-radius: 24px 24px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sheet-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes sheet-slide-up {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.sheet-handle {
  width: 36px;
  height: 4px;
  background: var(--border-medium, rgba(255, 255, 255, 0.12));
  border-radius: 2px;
  margin: 12px auto 0;
  flex-shrink: 0;
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem 1rem;
  flex-shrink: 0;
}

.sheet-title {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary, #f5f5f5);
  margin: 0;
}

.close-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  background: var(--bg-elevated, rgba(255, 255, 255, 0.04));
  color: var(--text-muted, rgba(255, 255, 255, 0.45));
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--bg-card, rgba(255, 255, 255, 0.06));
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
}

.close-btn svg {
  width: 18px;
  height: 18px;
}

/* Loading & Error states */
.loading-state,
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1.5rem;
  gap: 1rem;
  color: var(--text-muted, rgba(255, 255, 255, 0.45));
  font-family: 'DM Sans', -apple-system, sans-serif;
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
  padding: 0 1.5rem 2rem;
  padding-bottom: calc(2rem + env(safe-area-inset-bottom, 0px));
}

.section {
  margin-bottom: 1.5rem;
}

.section-label {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted, rgba(255, 255, 255, 0.45));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0;
}

/* Language Pills */
.language-pills-container {
  margin: 0 -1.5rem;
  padding: 0 1.5rem;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.language-pills-container::-webkit-scrollbar {
  display: none;
}

.language-pills {
  display: flex;
  gap: 0.5rem;
  padding-bottom: 0.25rem;
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

.pill-flag {
  font-size: 1.125rem;
  line-height: 1;
}

.pill-name {
  font-family: 'DM Sans', -apple-system, sans-serif;
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
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 0.5625rem;
  font-weight: 700;
  color: white;
  letter-spacing: 0.03em;
}

.target-flag {
  font-size: 2rem;
  line-height: 1;
}

.target-name {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary, #f5f5f5);
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

/* Sheet transition */
.sheet-enter-active {
  transition: opacity 0.3s ease;
}

.sheet-leave-active {
  transition: opacity 0.2s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .course-selector-sheet,
.sheet-leave-to .course-selector-sheet {
  transform: translateY(100%);
}

/* Responsive */
@media (max-width: 400px) {
  .target-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .sheet-content {
    padding: 0 1rem 1.5rem;
  }

  .sheet-header {
    padding: 1rem 1rem 0.75rem;
  }

  .language-pills-container {
    margin: 0 -1rem;
    padding: 0 1rem;
  }
}

@media (min-width: 500px) {
  .target-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

/* Light theme support */
[data-theme="light"] .course-selector-sheet {
  background: var(--bg-secondary);
}

[data-theme="light"] .language-pill.active {
  background: rgba(194, 58, 58, 0.1);
}

[data-theme="light"] .target-card.enrolled {
  background: rgba(74, 222, 128, 0.06);
}

[data-theme="light"] .target-card.active {
  background: rgba(194, 58, 58, 0.08);
}
</style>
