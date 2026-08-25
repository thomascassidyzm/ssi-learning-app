<script setup lang="ts">
/**
 * CourseSwitchRow — the ONE irreplaceable function rescued from the library
 * pill, rehomed cleanly.
 *
 * Founder ruling 2026-08-03: the profile replaces the aimless contents of the
 * library pill, but course switching is the one thing in there a learner
 * genuinely needs, so it must survive the move intact rather than being
 * quietly dropped.
 *
 * It reuses the app's existing course plumbing verbatim — the same
 * `enrolledCourses` list and the same `handleCourseSelect` the library pill
 * calls — so switching from here behaves identically to switching from there.
 * No new query, no second source of truth.
 */
import { computed, inject, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { getLanguageName } from '@/composables/useI18n'
import LanguageFlag from '@/components/schools/shared/LanguageFlag.vue'

interface CourseLike {
  course_code: string
  target_lang?: string
  known_lang?: string
  [k: string]: unknown
}

const router = useRouter()

const enrolledCourses = inject<Ref<CourseLike[]> | null>('enrolledCourses', null)
const activeCourse = inject<Ref<CourseLike | null> | null>('activeCourse', null)
const handleCourseSelect = inject<((c: CourseLike) => void) | null>('handleCourseSelect', null)

const courses = computed<CourseLike[]>(() => enrolledCourses?.value ?? [])
const currentCode = computed(() => activeCourse?.value?.course_code ?? null)

const others = computed(() => courses.value.filter((c) => c.course_code !== currentCode.value))

function switchTo(course: CourseLike): void {
  handleCourseSelect?.(course)
  router.push('/')
}
</script>

<template>
  <section v-if="courses.length" class="panel">
    <h2 class="title">Your languages</h2>

    <div v-if="activeCourse" class="current">
      <LanguageFlag v-if="activeCourse.target_lang" :code="activeCourse.course_code || activeCourse.target_lang" :size="20" />
      <span class="current-name">{{ getLanguageName(activeCourse.target_lang ?? '') }}</span>
      <span class="current-tag">carrying on with this one</span>
    </div>

    <div v-if="others.length" class="others">
      <button
        v-for="c in others"
        :key="c.course_code"
        type="button"
        class="other"
        @click="switchTo(c)"
      >
        <LanguageFlag v-if="c.target_lang" :code="c.course_code || c.target_lang" :size="18" />
        <span>{{ getLanguageName(c.target_lang ?? '') }}</span>
      </button>
    </div>

    <p class="footnote">
      Switching does not lose anything. Each one keeps its own place, waiting exactly where you left it.
    </p>
  </section>
</template>

<style scoped>
.panel {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}
.title {
  margin: 0;
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-secondary, #6B635C);
}
.current { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.current-name {
  font-size: var(--text-lg, 17px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
}
.current-tag { font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078); }
.others { display: flex; flex-wrap: wrap; gap: 8px; }
.other {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 999px; cursor: pointer;
  background: var(--bg-primary, #e8e3dd);
  border: 1px solid rgba(44, 38, 34, 0.08);
  font: inherit; font-size: var(--text-sm, 13px);
  color: var(--ink-primary, #2C2622);
}
.other:hover { border-color: rgba(44, 38, 34, 0.2); }
.flag { width: 20px; height: 20px; flex-shrink: 0; }
.footnote {
  margin: 0; font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078); line-height: 1.55;
}
</style>
