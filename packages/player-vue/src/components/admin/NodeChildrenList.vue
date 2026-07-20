<script setup lang="ts">
// NodeChildrenList — the CHILDREN LIST of THE VIEW (docs/THE-VIEW.md §1.4):
// whatever this node's children are, in the SAME row grammar at every depth.
// The founder's lenses (All groups / All schools / All teachers / All
// classes) are filters over this one list — each lens maps its payload onto
// the same row shape: avatar initial, name (click → that thing's home),
// caption, count columns.
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { classHomePath, groupHomePath, isMemberNodeSurface, schoolHomePath } from '@/composables/nodeSurfacePaths'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import HealthDot from '@/components/schools/shared/HealthDot.vue'
import JourneyBar from '@/components/schools/shared/JourneyBar.vue'
import Sparkline from '@/components/schools/shared/Sparkline.vue'
import type { Belt } from '@/composables/schools/belts'

interface Row {
  key: string
  name: string
  caption: string
  badge?: string | null
  counts: { value: string | number; word: string }[]
  to: string | null
  belt?: Belt | null
  health?: string | null
  /** Course-journey position, rendered inline on the row (students). */
  journey?: { done: number; total: number } | null
  /** Last-7-days minutes, rendered as an inline sparkline (students). */
  spark?: { minutes: number[]; week_minutes: number } | null
}

const props = defineProps<{
  lens: string
  payload: Record<string, any>
}>()

const router = useRouter()
const route = useRoute()
// Member mount (leader inside /schools) vs admin mount — same rows, links
// stay within the caller's own scope (see nodeSurfacePaths.ts).
const member = computed(() => isMemberNodeSurface(route.path))

function initial(name: string): string {
  return (name.trim()[0] || '?').toUpperCase()
}

function joinNames(names: string[], cap = 3): string {
  if (!names.length) return ''
  if (names.length <= cap) return names.join(', ')
  return `${names.slice(0, cap).join(', ')} +${names.length - cap} more`
}

const rows = computed<Row[]>(() => {
  const p = props.payload
  if (props.lens === 'children') {
    return (p.children || []).map((n: any): Row => ({
      key: n.id,
      name: n.name,
      caption: n.hasSchool || n.commercial ? 'School' : (n.label ? n.label[0].toUpperCase() + n.label.slice(1) : 'Group'),
      badge: n.is_demo ? 'Demo' : null,
      counts: [
        ...(n.rollup?.childGroupCount ? [{ value: n.rollup.childGroupCount, word: 'below' }] : []),
        { value: n.rollup?.teacherCount ?? 0, word: 'teachers' },
        { value: n.rollup?.classCount ?? 0, word: 'classes' },
        { value: n.rollup?.learnerCount ?? 0, word: 'learners' },
      ],
      to: groupHomePath(n.id, member.value),
    }))
  }
  if (props.lens === 'groups') {
    return (p.groups || []).map((g: any): Row => ({
      key: g.id,
      name: g.name,
      caption: `${g.hasSchool ? 'School' : 'Group'}${g.parentName ? ` · under ${g.parentName}` : ''}`,
      badge: g.is_demo ? 'Demo' : null,
      counts: [
        { value: g.rollup?.teacherCount ?? 0, word: 'teachers' },
        { value: g.rollup?.classCount ?? 0, word: 'classes' },
        { value: g.rollup?.learnerCount ?? 0, word: 'learners' },
      ],
      to: groupHomePath(g.id, member.value),
    }))
  }
  if (props.lens === 'schools') {
    return (p.schools || []).map((s: any): Row => ({
      key: s.schoolId,
      name: s.name,
      caption: s.teachers?.length ? joinNames(s.teachers) : 'No teachers yet',
      badge: !s.hasAdmin ? 'Awaiting admin' : null,
      counts: [
        { value: s.studentCount, word: 'students' },
        { value: s.classCount, word: 'classes' },
        { value: `${s.practiceHours}h`, word: 'practised' },
      ],
      // Stay inside the one map surface: a school IS a node (THE MODEL I2),
      // so open its node home rather than repainting a separate school page.
      to: schoolHomePath(s.nodeId, s.schoolId, member.value),
    }))
  }
  if (props.lens === 'teachers') {
    return (p.teachers || []).map((t: any): Row => ({
      key: t.user_id,
      name: t.name,
      caption: t.classes?.length
        ? joinNames(t.classes.map((c: any) => c.name))
        : 'No classes yet',
      counts: [{ value: t.classes?.length ?? 0, word: t.classes?.length === 1 ? 'class' : 'classes' }],
      to: t.classes?.length === 1 ? classHomePath(t.classes[0].id, member.value) : null,
    }))
  }
  if (props.lens === 'classes') {
    return (p.classes || []).map((c: any): Row => ({
      key: c.id,
      name: c.name,
      caption: [c.home, joinNames(c.teachers || [])].filter(Boolean).join(' · '),
      counts: [
        { value: c.studentCount, word: 'students' },
        { value: `${c.practiceHours}h`, word: 'practised' },
      ],
      to: classHomePath(c.id, member.value),
    }))
  }
  if (props.lens === 'students') {
    // The teaching row, FLAT (founder ruling 2026-07-19): everything a
    // teacher needs on the one row, no click — health flag, last practised,
    // course-journey position, belt, LEGOs, hours, last 7 days. There is no
    // individual learner page and no expansion. No streak — streaks are
    // banned (docs/gamification-done-right.md).
    return (p.students || []).map((s: any): Row => ({
      key: s.learner_id,
      name: s.name,
      caption: s.last_active_at
        ? `Last practised ${new Date(s.last_active_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
        : 'Not started yet',
      belt: s.belt || null,
      health: s.health || null,
      counts: [
        { value: s.legos_mastered ?? 0, word: 'LEGOs' },
        { value: `${s.practice_hours}h`, word: 'practised' },
      ],
      to: null,
      journey: { done: s.legos_mastered ?? 0, total: Math.max(s.journey_total ?? 0, s.legos_mastered ?? 0) },
      spark: { minutes: s.last7_minutes ?? [], week_minutes: s.week_minutes ?? 0 },
    }))
  }
  return []
})

function open(row: Row): void {
  if (row.to) router.push(row.to)
}
</script>

<template>
  <ul class="child-list">
    <li v-for="row in rows" :key="row.key" class="child-row" :class="{ 'is-static': !row.to, 'is-flat': !!row.journey }">
      <button type="button" class="child-btn" :disabled="!row.to" @click="open(row)">
        <span class="child-avatar">{{ initial(row.name) }}</span>
        <span class="child-main">
          <span class="child-name-line">
            <span class="child-name">{{ row.name }}</span>
            <span v-if="row.badge" class="child-badge">{{ row.badge }}</span>
          </span>
          <span v-if="row.caption" class="child-caption">
            <template v-if="row.health"><HealthDot :health="row.health as any" /> {{ row.health.replace('-', ' ') }} · </template>{{ row.caption }}
          </span>
        </span>
        <span v-if="row.journey" class="child-journey">
          <JourneyBar :done="row.journey.done" :total="row.journey.total" label="" />
          <span class="child-journey-note">{{ row.journey.done }}<template v-if="row.journey.total"> of {{ row.journey.total }}</template> LEGOs</span>
        </span>
        <span v-if="row.spark" class="child-spark">
          <Sparkline :data="row.spark.minutes" :width="96" :height="26" />
          <span class="child-count-word">{{ row.spark.week_minutes }}m this wk</span>
        </span>
        <span class="child-counts">
          <span v-if="row.belt" class="child-count child-belt">
            <span class="child-count-value"><BeltDot :belt="row.belt" :size="12" /> {{ row.belt }}</span>
            <span class="child-count-word">belt</span>
          </span>
          <span v-for="(c, i) in row.counts" :key="i" class="child-count">
            <span class="child-count-value frost-mono-nums">{{ c.value }}</span>
            <span class="child-count-word">{{ c.word }}</span>
          </span>
        </span>
        <span v-if="row.to" class="child-open" aria-hidden="true">→</span>
      </button>
    </li>
    <li v-if="rows.length === 0" class="child-empty">
      <slot name="empty">Nothing here yet.</slot>
    </li>
  </ul>
</template>

<style scoped>
.child-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.child-row + .child-row { border-top: 1px solid rgba(44, 38, 34, 0.06); }

.child-btn {
  display: flex; align-items: center; gap: var(--space-4); width: 100%;
  padding: 12px var(--space-4); border: none; background: none; font: inherit;
  text-align: left; cursor: pointer; min-width: 0;
}
.child-btn:disabled { cursor: default; }
.child-btn:not(:disabled):hover { background: rgba(255, 255, 255, 0.65); }
.child-btn:not(:disabled):hover .child-name { text-decoration: underline; }

.child-avatar {
  width: 36px; height: 36px; flex-shrink: 0; display: grid; place-items: center;
  background: var(--schools-red, #DB1E17); color: #fff; border-radius: 10px;
  font-weight: var(--font-bold, 700); font-size: var(--text-sm);
}
.child-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.child-name-line { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.child-name {
  font-weight: var(--font-semibold); color: var(--schools-fg, #0F1212); font-size: var(--text-base);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.child-badge {
  flex-shrink: 0; font-size: var(--text-xs); padding: 1px 8px; border-radius: 999px;
  background: rgba(var(--tone-amber, 194 132 58), 0.12); color: rgb(var(--tone-amber-ink, 154 96 24));
}
.child-caption {
  font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.child-counts { display: flex; gap: var(--space-4); flex-shrink: 0; }
.child-count { display: flex; flex-direction: column; align-items: flex-end; min-width: 56px; }
.child-count-value { font-weight: var(--font-semibold); color: var(--schools-fg, #0F1212); font-size: var(--text-sm); }
.child-count-word { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3, #8A8078); }
.child-open { color: var(--schools-red, #DB1E17); flex-shrink: 0; font-size: var(--text-sm); }

.child-empty { padding: var(--space-6); text-align: center; color: var(--schools-fg-3, #8A8078); font-size: var(--text-sm); }

.child-belt .child-count-value { display: inline-flex; align-items: center; gap: 5px; text-transform: capitalize; }
.child-caption { display: inline-flex; align-items: center; gap: 4px; }

.child-journey { display: flex; flex-direction: column; gap: 3px; width: 150px; flex-shrink: 0; }
/* The row's own "X of Y LEGOs" note carries the numbers — JourneyBar's
   built-in fraction head would say the same thing twice. */
.child-journey :deep(.journey-head) { display: none; }
.child-journey-note { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3, #8A8078); }
.child-spark { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }

@media (max-width: 640px) {
  /* Structure rows drop their counts on phone — the name is the point.
     Student rows are the teaching surface: they WRAP instead, keeping
     belt / LEGOs / hours / journey visible (founder ruling 2026-07-19). */
  .child-row:not(.is-flat) .child-counts { display: none; }
  .is-flat .child-btn { flex-wrap: wrap; }
  .is-flat .child-main { flex-basis: calc(100% - 36px - var(--space-4)); }
  .is-flat .child-journey { width: 100%; order: 4; }
  .is-flat .child-counts { order: 2; width: 100%; justify-content: flex-start; padding-left: calc(36px + var(--space-4)); }
  .is-flat .child-count { align-items: flex-start; min-width: 0; }
  .is-flat .child-spark { display: none; }
}
</style>
