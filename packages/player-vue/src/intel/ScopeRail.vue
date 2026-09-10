<script setup lang="ts">
/**
 * ScopeRail — where you are, and it IS the org dashboard's map rail,
 * generalised by one level.
 *
 * Design §3.1: the rail's root is "Everyone" and its three branches are
 * Courses, Organisations and People; under Organisations it is the existing
 * org rail unchanged. Tom's ruling on the shell was "share", so this does not
 * draw a second rail in the same shape — it hands NodeMapRail the ancestors,
 * the node, the siblings and the children of the current scope and lets the
 * one rail the eye already knows draw them.
 *
 * Changing scope re-asks the SAME question for the new scope: a course row
 * writes the course into the URL and the page re-fetches. The Organisations
 * and People rows open the two trees you find a named thing in — one tap to
 * the tree, one more to the thing, which is the design's two-tap rule.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NodeMapRail, { type RailRef } from '@/components/admin/NodeMapRail.vue'

const props = defineProps<{
  /** Courses the current question can be scoped to, most relevant first. */
  courses?: { code: string; name: string }[]
  /** False on questions that cannot be scoped to one course. */
  courseScopable?: boolean
}>()

const route = useRoute()

const activeCourse = computed(() => (route.query.course as string | undefined) || null)

/** The path that asks this question of one course, or of everyone. */
function scopedPath(course: string | null): string {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(route.query)) {
    if (k === 'course') continue
    if (typeof v === 'string') query.set(k, v)
  }
  if (course) query.set('course', course)
  const qs = query.toString()
  return `${route.path}${qs ? `?${qs}` : ''}`
}

const everyone: RailRef = { id: 'everyone', name: 'Everyone', label: 'every real person', path: '' }

const courseRefs = computed<RailRef[]>(() =>
  props.courseScopable
    ? (props.courses ?? []).map((c) => ({ id: `course:${c.code}`, name: c.name, label: 'course', path: scopedPath(c.code) }))
    : [],
)

const organisations: RailRef = { id: 'organisations', name: 'Organisations', label: 'the tree', path: '/admin/structure' }
const people: RailRef = { id: 'people', name: 'People', label: 'everyone we know about', path: '/admin/users' }

// At root the current node is Everyone and the branches are its children. On
// a course the course is the node, Everyone is above it, and the other
// courses are its siblings — the same shape the org rail draws for a school
// inside a group.
const ancestors = computed<RailRef[]>(() =>
  activeCourse.value ? [{ ...everyone, path: scopedPath(null) }] : [],
)
const node = computed(() => {
  const c = activeCourse.value
  if (!c) return { id: everyone.id, name: everyone.name, label: everyone.label }
  const named = props.courses?.find((x) => x.code === c)
  return { id: `course:${c}`, name: named?.name ?? c, label: 'course' }
})
const siblings = computed<RailRef[]>(() =>
  activeCourse.value ? courseRefs.value.filter((r) => r.id !== `course:${activeCourse.value}`) : [],
)
const children = computed<RailRef[]>(() =>
  activeCourse.value ? [] : [...courseRefs.value, organisations, people],
)
</script>

<template>
  <!-- HANDBOOK Choosing who a question is asked about
       section: seeing-progress
       roles: admin
       place: intel
       keywords: scope, everyone, course, organisation, people, rail, where you are
       What it's for. Asking the same question of a smaller group: everyone,
       one course, one organisation or one person. The question does not
       change; who it is about does.
       Where it is. The map on the left of every question page, the same map
       the organisation dashboard draws. On a phone it is the first block.
       How you do it.
       1. Tap **Everyone** to ask the question of every real person.
       2. Tap a course to ask it of that course alone. The other courses stay
          one tap away as the rows at this level.
       3. Tap **Organisations** to go to the organisation tree and pick a
          group, a school or a class.
       4. Tap **People** to find one person by name or email.
       Worth knowing. The choice is written into the page address, so a pasted
       link opens the same question about the same people.
       checked: 3ef45065.886d1834
  -->
  <nav class="scope-rail" aria-label="Where you are" data-intel="scope-rail">
    <p v-if="!props.courseScopable" class="rail-note">This question is asked of everyone.</p>
    <p v-else-if="!props.courses?.length" class="rail-note">No courses with real people in them yet.</p>
    <NodeMapRail
      :ancestors="ancestors"
      :node="node"
      :siblings="siblings"
      :children="children"
      member
    />
  </nav>
</template>

<style scoped>
.scope-rail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg);
}
.rail-note { font-size: 12px; color: var(--schools-fg-3); margin: 0; }
</style>
