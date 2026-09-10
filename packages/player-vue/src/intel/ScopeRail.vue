<script setup lang="ts">
/**
 * ScopeRail — where you are, generalised by one level.
 *
 * Design §3.1: the rail's root is "Everyone" and its three branches are
 * Courses, Organisations and People. Under Organisations it is the existing
 * org rail, unchanged — this component does not reimplement NodeMapRail, it
 * hands off to it by linking into the org tree at /admin/structure.
 *
 * Changing scope re-asks the SAME question for the new scope: the rail writes
 * the scope into the URL and the page re-fetches. It never navigates to a
 * different question, and it never repaints the page around it — the 2026-07-30
 * stability ruling.
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const props = defineProps<{
  /** Courses the current question can be scoped to, most relevant first. */
  courses?: { code: string; name: string }[]
  /** False on questions that cannot be scoped to one course. */
  courseScopable?: boolean
}>()

const route = useRoute()
const router = useRouter()

const activeCourse = computed(() => (route.query.course as string | undefined) || null)

function scopeTo(course: string | null): void {
  const query = { ...route.query }
  if (course) query.course = course
  else delete query.course
  router.replace({ path: route.path, query })
}
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
       Where it is. The map on the left of every question page. On a phone it
       is the first block.
       How you do it.
       1. Tap **Everyone** to ask the question of every real person.
       2. Tap a course under **Courses** to ask it of that course alone.
       3. Tap **Organisations** to go to the organisation tree and pick a
          group, a school or a class.
       4. Tap **People** to find one person by name or email.
       Worth knowing. The choice is written into the page address, so a pasted
       link opens the same question about the same people.
       checked: 3ef45065.de5a5507
  -->
  <nav class="scope-rail" aria-label="Where you are" data-intel="scope-rail">
    <button
      type="button"
      class="rail-row root"
      :class="{ here: !activeCourse }"
      @click="scopeTo(null)"
    >Everyone</button>

    <div class="branch">
      <span class="branch-name">Courses</span>
      <p v-if="!props.courseScopable" class="branch-note">This question is asked of everyone.</p>
      <p v-else-if="!props.courses?.length" class="branch-note">No courses with people in them yet.</p>
      <button
        v-for="c in (props.courseScopable ? props.courses ?? [] : [])"
        :key="c.code"
        type="button"
        class="rail-row"
        :class="{ here: activeCourse === c.code }"
        @click="scopeTo(c.code)"
      >{{ c.name }}</button>
    </div>

    <div class="branch">
      <span class="branch-name">Organisations</span>
      <router-link to="/admin/structure" class="rail-row link">The organisation tree</router-link>
    </div>

    <div class="branch">
      <span class="branch-name">People</span>
      <router-link to="/admin/users" class="rail-row link">Everyone we know about</router-link>
    </div>
  </nav>
</template>

<style scoped>
.scope-rail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--schools-card, #fff);
  border: 1px solid var(--schools-border, rgba(15, 18, 18, .10));
  border-radius: var(--schools-radius-lg, 12px);
}

.branch { display: flex; flex-direction: column; gap: 2px; }

.branch-name {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red);
  margin-bottom: 4px;
}

.branch-note { font-size: 12px; color: var(--schools-fg-3); padding: 2px 8px; }

.rail-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: none;
  background: none;
  border-radius: var(--schools-radius-sm, 6px);
  font: inherit;
  font-size: 13px;
  color: var(--schools-fg-2);
  text-decoration: none;
  cursor: pointer;
}
.rail-row:hover { background: var(--schools-bg, #f6f5f1); color: var(--schools-fg); }
.rail-row.here { color: var(--schools-fg); font-weight: 600; box-shadow: inset 2px 0 0 var(--schools-red); }
.rail-row.root { font-size: 14px; }
</style>
