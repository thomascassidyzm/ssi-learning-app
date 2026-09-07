<script setup lang="ts">
// NodeBelowTree — BELOW THIS, drawn (founder ruling 2026-09-07: the panel
// "is a little confusing as is… should this be actually a little more
// diagrammatic, something like a tree structure? it's not entirely clear
// what it is").
//
// One recursive row grammar over the containment structure: this node, then
// what hangs beneath it — child nodes nested, their classes as leaves, staff
// with no class of their own. It REPLACES the five filter chips: four of them
// (directly below / all groups / all schools / all classes) were positions in
// this one structure, so the tree says all four at once and the reader sees
// the SHAPE instead of one slice at a time. Teachers are named on the classes
// they teach, which is where a leader looks for them.
//
// Since authority is inherited downward from the org root, this picture is
// also the picture of what its leader may act on.
//
// TAP IS THE ONLY AFFORDANCE: tap a caret to open/close, tap a name to go
// there. No drag, no swipe, no long-press. STATE IS DRAWN, NOT ANNOTATED: an
// empty node has nothing under it and no caret; a class with no teacher names
// none; zero counts are simply absent.
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { classHomePath, groupHomePath, isMemberNodeSurface } from '@/composables/nodeSurfacePaths'
import { isEmptyNode, type BelowNode, type BelowPerson } from './belowTree'

const props = withDefaults(defineProps<{
  node: BelowNode
  depth?: number
  /** The node the page itself is about — drawn as the trunk, not a link. */
  isRoot?: boolean
  /** Sibling sets that mix groups and schools say which is which. */
  showLabel?: boolean
  /** Demo is marked once at the top of a demo subtree, as in Structure. */
  parentIsDemo?: boolean
  /**
   * Per-person verbs (a head on their own school node): assign a teacher to
   * classes, mint them an access code. They live on the PERSON row because
   * they belong to the person — the reason people are drawn in the tree at
   * all rather than only named on the classes they teach.
   */
  personActionLabel?: string
  personAction2Label?: string
}>(), { depth: 0, isRoot: false, showLabel: false, parentIsDemo: false })

const emit = defineEmits<{
  (e: 'person-action', person: BelowPerson): void
  (e: 'person-action-2', person: BelowPerson): void
}>()

const router = useRouter()
const route = useRoute()
const member = computed(() => isMemberNodeSurface(route.path))

// How many rows this node would draw if opened. A node that would unroll a
// long list starts closed; the root always starts open, because a card that
// opens shut says nothing.
// Long lists degrade by cap-and-reveal, never by scroll: the biggest real
// structures are 49 classes flat on one node (Ysgol Gyfun Tredegar) and 39
// staff on another (Chepstow), and either would bury the shape.
const CLASS_CAP = 8
const STAFF_CAP = 8
const OPEN_ROWS = 12
const rowCount = computed(() => props.node.children.length + props.node.classes.length + props.node.staff.length)
const hasBelow = computed(() => rowCount.value > 0 || props.node.hiddenGroups > 0)
// SHAPE FIRST: the top two levels open themselves, deeper ones wait to be
// tapped. Seen live on the 13-node IME tree, opening everything unrolled 85
// rows and buried the very structure the panel exists to show.
const open = ref(props.isRoot || (props.depth < 2 && rowCount.value <= OPEN_ROWS))
const showAllClasses = ref(false)
const shownClasses = computed(() =>
  showAllClasses.value ? props.node.classes : props.node.classes.slice(0, CLASS_CAP))
const hiddenClasses = computed(() => props.node.classes.length - shownClasses.value.length)
const showAllStaff = ref(false)
const shownStaff = computed(() => (showAllStaff.value ? props.node.staff : props.node.staff.slice(0, STAFF_CAP)))
const hiddenStaff = computed(() => props.node.staff.length - shownStaff.value.length)

const childLabelsMixed = computed(() => new Set(props.node.children.map((c) => c.label)).size > 1)
const showDemoBadge = computed(() => props.node.isDemo && !props.parentIsDemo)
const labelWord = computed(() => (props.node.label === 'lea' ? 'LEA' : props.node.label))
const empty = computed(() => isEmptyNode(props.node))

function openNode(): void {
  if (props.isRoot) return
  router.push(groupHomePath(props.node.id, member.value))
}
function initial(name: string): string {
  return (name.trim()[0] || '?').toUpperCase()
}
function openClass(id: string): void {
  router.push(classHomePath(id, member.value))
}
</script>

<template>
  <div class="tree-node" :class="{ 'is-root': isRoot }">
    <div class="tree-row" :class="[`depth-${Math.min(depth, 3)}`, { 'is-empty': empty }]">
      <span v-if="depth > 0" class="tree-rails" aria-hidden="true">
        <span v-for="i in depth" :key="i" class="rail"></span>
      </span>
      <button
        v-if="hasBelow"
        type="button"
        class="tree-caret"
        :aria-expanded="open"
        :aria-label="open ? `Close ${node.name}` : `Open ${node.name}`"
        @click="open = !open"
      >{{ open ? '▾' : '▸' }}</button>
      <span v-else class="tree-caret is-leaf" aria-hidden="true"></span>

      <!-- HANDBOOK Walking down to a school, a class or a person
           section: seeing-progress
           roles: admin, leader, school_admin
           place: node-home
           keywords: tree, below, structure, drill down, school, class, teacher, nested
           What it's for. A drawn tree of everything hanging beneath the level you are on
           — groups inside groups, the classes in each, the teachers who take them and
           the staff who teach nothing yet. It is one picture of the shape of your
           organisation, not a list you have to filter.
           Where it is. The **Below this** panel under the numbers on any group or school
           page.
           How you do it.
           1. Open a group or a school.
           2. Tap a caret to open or close what sits under a name.
           3. Tap any name to go to that level — the numbers and the tree redraw for it.
           4. A class row names its teachers and its student count without you opening
              it.
           5. Where there are more than eight classes or people, a **more** button
              reveals the rest.
           Worth knowing. The top two levels open themselves and deeper ones wait to be
           tapped, so a large organisation shows you its shape instead of eighty-five
           rows.
           checked: 5d58fdb7
      -->
      <button
        type="button"
        class="tree-name"
        data-walk="below-tree-name"
        :class="{ 'is-here': isRoot }"
        :disabled="isRoot"
        @click="openNode"
      >{{ node.name }}</button>

      <span v-if="isRoot" class="tree-here">you’re here</span>
      <span v-else-if="showLabel" class="tree-label">{{ labelWord }}</span>
      <span v-if="showDemoBadge" class="tree-badge">Demo</span>

      <span v-if="node.learners" class="tree-count frost-mono-nums">
        {{ node.learners }} learner<template v-if="node.learners !== 1">s</template>
      </span>
    </div>

    <template v-if="open">
      <NodeBelowTree
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :show-label="childLabelsMixed"
        :parent-is-demo="node.isDemo || parentIsDemo"
        :person-action-label="personActionLabel"
        :person-action2-label="personAction2Label"
        @person-action="emit('person-action', $event)"
        @person-action-2="emit('person-action-2', $event)"
      />

      <div v-for="c in shownClasses" :key="c.id" class="tree-row is-class" :class="`depth-${Math.min(depth + 1, 3)}`">
        <span class="tree-rails" aria-hidden="true">
          <span v-for="i in depth + 1" :key="i" class="rail"></span>
        </span>
        <span class="tree-caret is-leaf" aria-hidden="true"></span>
        <button type="button" class="tree-name is-class-name" @click="openClass(c.id)">{{ c.name }}</button>
        <span v-if="c.teachers.length" class="tree-teachers">{{ c.teachers.join(', ') }}</span>
        <span v-if="c.studentCount" class="tree-count frost-mono-nums">
          {{ c.studentCount }} student<template v-if="c.studentCount !== 1">s</template>
        </span>
      </div>

      <div v-if="hiddenClasses > 0" class="tree-more" :class="`depth-${Math.min(depth + 1, 3)}`">
        <span class="tree-rails" aria-hidden="true">
          <span v-for="i in depth + 1" :key="i" class="rail"></span>
        </span>
        <button type="button" class="tree-more-btn" @click="showAllClasses = true">
          {{ hiddenClasses }} more class<template v-if="hiddenClasses !== 1">es</template>
        </button>
      </div>

      <!-- People in this node who teach no class. Drawn, so an invited
           teacher with nothing to teach yet is visible rather than missing. -->
      <div v-for="p in shownStaff" :key="p.user_id" class="tree-row is-person" :class="`depth-${Math.min(depth + 1, 3)}`">
        <span class="tree-rails" aria-hidden="true">
          <span v-for="i in depth + 1" :key="i" class="rail"></span>
        </span>
        <span class="tree-person-dot" aria-hidden="true">{{ initial(p.name) }}</span>
        <span class="tree-name is-person-name">{{ p.name }}</span>
        <button
          v-if="personActionLabel"
          type="button"
          class="tree-person-action"
          data-walk="teacher-assign-classes"
          @click="emit('person-action', p)"
        >{{ personActionLabel }}</button>
        <button
          v-if="personAction2Label"
          type="button"
          class="tree-person-action"
          data-walk="teacher-signin-link"
          @click="emit('person-action-2', p)"
        >{{ personAction2Label }}</button>
      </div>

      <div v-if="hiddenStaff > 0" class="tree-more" :class="`depth-${Math.min(depth + 1, 3)}`">
        <span class="tree-rails" aria-hidden="true">
          <span v-for="i in depth + 1" :key="i" class="rail"></span>
        </span>
        <button type="button" class="tree-more-btn" @click="showAllStaff = true">
          {{ hiddenStaff }} more <template v-if="hiddenStaff === 1">person</template><template v-else>people</template>
        </button>
      </div>

      <div v-if="node.hiddenGroups > 0" class="tree-more" :class="`depth-${Math.min(depth + 1, 3)}`">
        <span class="tree-rails" aria-hidden="true">
          <span v-for="i in depth + 1" :key="i" class="rail"></span>
        </span>
        <button type="button" class="tree-more-btn" @click="openNode">
          {{ node.hiddenGroups }} more below — open {{ node.name }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree-node { display: contents; }

.tree-row {
  display: flex;
  align-items: center;
  gap: var(--space-2, 8px);
  padding: 6px var(--space-4);
  font-size: var(--text-sm);
  min-width: 0;
}
.is-root > .tree-row { padding-top: var(--space-3, 12px); }

/* Depth rails — one faint vertical guide per ancestor level, the same idiom
   the Structure tree uses, so the two trees read as one language. */
.tree-rails { display: flex; flex: none; align-self: stretch; margin: -6px 0; }
.rail { width: 20px; position: relative; }
.rail::before {
  content: '';
  position: absolute;
  left: 6px; top: 0; bottom: 0;
  width: 1px;
  background: rgba(44, 38, 34, 0.10);
}
@media (max-width: 640px) { .rail { width: 14px; } }

.tree-caret {
  flex: none;
  width: 22px; height: 22px;
  display: grid; place-items: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--schools-fg-3, #8A8078);
  font-size: 11px;
  cursor: pointer;
  border-radius: var(--radius-sm, 6px);
}
.tree-caret:hover { color: var(--schools-fg, #0F1212); background: rgba(255, 255, 255, 0.7); }
.tree-caret.is-leaf { cursor: default; }
@media (max-width: 640px) { .tree-caret { width: 28px; height: 28px; } }

.tree-name {
  min-width: 0;
  padding: 2px 4px;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  color: var(--schools-fg, #0F1212);
  font-weight: var(--font-semibold);
  cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tree-name:not(:disabled):hover { text-decoration: underline; }
.tree-name:disabled { cursor: default; }
/* Typography steps down by level, so indentation is not carrying the
   hierarchy alone. */
.depth-1 .tree-name { font-weight: var(--font-medium); }
.depth-2 .tree-name, .depth-3 .tree-name { font-weight: var(--font-medium); font-size: 13px; }
.tree-name.is-here { color: var(--schools-fg, #0F1212); }
.tree-name.is-class-name { font-weight: var(--font-medium); color: var(--schools-fg-2, #3A3A3A); }
.tree-name.is-person-name { font-weight: var(--font-normal, 400); color: var(--schools-fg-2, #3A3A3A); cursor: default; }

.tree-here, .tree-label, .tree-badge {
  flex: none;
  font-size: var(--text-xs);
  color: var(--schools-fg-3, #8A8078);
}
.tree-here { color: rgb(var(--tone-red)); }
.tree-label { font-family: var(--font-mono); font-size: 10.5px; opacity: 0.75; }
.tree-badge {
  padding: 1px 8px;
  border-radius: var(--radius-full, 999px);
  background: rgba(var(--tone-amber, 194 132 58), 0.12);
  color: rgb(var(--tone-amber-ink, 154 96 24));
}

.tree-teachers {
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--schools-fg-3, #8A8078);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tree-count {
  margin-left: auto;
  flex: none;
  padding-left: var(--space-3, 12px);
  font-size: var(--text-xs);
  color: var(--schools-fg-3, #8A8078);
}

/* A person is not a class. The page already speaks in initialled avatars, so
   people carry a small quiet one and read as people at a glance — without it,
   live on the IME tree, "Anjali Das" and "Y7 English" were the same row. */
.tree-person-dot {
  flex: none;
  width: 22px; height: 22px;
  display: grid; place-items: center;
  border-radius: 50%;
  background: rgba(44, 38, 34, 0.07);
  color: var(--schools-fg-3, #8A8078);
  font-size: 10px;
  font-weight: var(--font-semibold);
}

.tree-person-action {
  flex: none;
  padding: 3px 10px;
  font: inherit;
  font-size: var(--text-xs);
  border-radius: 8px;
  border: 1px solid rgba(44, 38, 34, 0.16);
  background: rgba(255, 255, 255, 0.7);
  color: var(--schools-fg, #0F1212);
  cursor: pointer;
  white-space: nowrap;
}
.tree-person-action:hover { background: #fff; }

.tree-more { display: flex; align-items: center; padding: 2px var(--space-4) 6px; }
.tree-more .tree-rails { margin: -2px 0 -6px; }
.tree-more-btn {
  margin-left: 22px;
  padding: 2px 4px;
  border: none;
  background: none;
  font: inherit;
  font-size: var(--text-xs);
  color: var(--schools-red, #DB1E17);
  cursor: pointer;
}
.tree-more-btn:hover { text-decoration: underline; }

@media (max-width: 640px) {
  /* The name is the point on a phone; the teacher list is the first thing to
     give up its width. */
  .tree-teachers { display: none; }
}
</style>
