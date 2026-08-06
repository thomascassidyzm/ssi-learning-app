<script setup lang="ts">
// NodeMapRail — the MAP of the org with a visual indicator of where you are
// (docs/THE-VIEW.md §1.1). Ancestor path from the org root down to here,
// you-are-here lit, siblings one tap away, children below — the whole org
// navigable up/down from any node without leaving the page. Same rail at
// every level; this is the spine of THE VIEW.
import { computed, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { groupHomePath, isMemberNodeSurface } from '@/composables/nodeSurfacePaths'

// Siblings-open state survives the rail remounting across sibling views of
// the same node (Overview <-> Insights) — part of the WHERE-YOU-ARE
// stability ruling (2026-07-30): the tree must not visibly reset on a hop.
const siblingsOpenByNode = reactive(new Map<string, boolean>())

export interface RailRef {
  id: string
  name: string
  label: string
  is_demo?: boolean
  hasSchool?: boolean
  /** Navigate here instead of the node-home path (flat surfaces, e.g. a
   * teacher's class rows opening /schools/classes/:id). */
  path?: string
  /** Orientation-only row: shown for context, not navigable. The founder
   * ruling (2026-07-31) — the rail is orientation, not navigation — a
   * permission-capped user still SEES the level above (e.g. a teacher's
   * school) even though they can't open it. */
  inert?: boolean
}

const props = defineProps<{
  ancestors: RailRef[]
  node: { id: string; name: string; label: string }
  siblings: RailRef[]
  children: RailRef[]
  /** 'class' renders the current node as a leaf (no child nav rows). */
  kind?: 'node' | 'class'
  /** Force member scope (flat /schools views sit outside /org, so
   * path detection alone would wrongly show the admin escape). OR-semantics:
   * true forces member; absent/false falls back to path detection — Vue
   * defaults absent boolean props to false, so ?? can't express this. */
  member?: boolean
}>()

const router = useRouter()
const route = useRoute()
// Member mount (leader inside /schools) vs admin mount — same rail, links
// stay within the caller's own scope (see nodeSurfacePaths.ts).
const member = computed(() => props.member || isMemberNodeSurface(route.path))
const showSiblings = computed({
  get: () => siblingsOpenByNode.get(props.node.id) ?? false,
  set: (open: boolean) => { siblingsOpenByNode.set(props.node.id, open) },
})

function open(ref_: RailRef): void {
  if (ref_.inert) return
  router.push(ref_.path || groupHomePath(ref_.id, member.value))
}

function labelWord(r: RailRef): string {
  if (r.hasSchool || r.label === 'school') return 'school'
  return r.label || 'group'
}
</script>

<template>
  <nav class="map-rail" aria-label="Organisation map">
    <!-- The way UP and OUT (founder pass C, 2026-07-19): from any depth,
         one obvious control back to the Structure overview — the rail's
         ancestors go up the tree; this goes up out of it. -->
    <!-- Members have no forest above their top node — the rail is already
         rooted at their scope, so the admin escape doesn't render. -->
    <router-link v-if="!member" to="/admin/structure" class="rail-up">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
      <span>All organisations</span>
    </router-link>
    <span class="schools-kicker rail-kicker">Where you are</span>
    <ol class="rail-list">
      <li v-for="(a, i) in props.ancestors" :key="a.id" class="rail-row is-ancestor" :style="{ '--depth': i }">
        <span v-if="a.inert" class="rail-link is-inert">
          <span class="rail-name">{{ a.name }}</span>
          <span class="rail-label">{{ labelWord(a) }}</span>
        </span>
        <button v-else type="button" class="rail-link" @click="open(a)">
          <span class="rail-name">{{ a.name }}</span>
          <span class="rail-label">{{ labelWord(a) }}</span>
        </button>
      </li>
      <li class="rail-row is-here" :style="{ '--depth': props.ancestors.length }" aria-current="page">
        <span class="rail-here">
          <span class="rail-name">{{ props.node.name }}</span>
          <span class="rail-label">you're here</span>
        </span>
      </li>
      <li v-if="props.siblings.length" class="rail-row is-siblings" :style="{ '--depth': props.ancestors.length }">
        <button type="button" class="rail-toggle" @click="showSiblings = !showSiblings">
          {{ showSiblings ? '▾' : '▸' }} {{ props.siblings.length }} other{{ props.siblings.length === 1 ? '' : 's' }} at this level
        </button>
        <ul v-if="showSiblings" class="rail-sublist">
          <li v-for="s in props.siblings" :key="s.id">
            <button type="button" class="rail-link" @click="open(s)">
              <span class="rail-name">{{ s.name }}</span>
              <span class="rail-label">{{ labelWord(s) }}</span>
            </button>
          </li>
        </ul>
      </li>
      <li
        v-for="c in props.children"
        :key="c.id"
        class="rail-row is-child"
        :style="{ '--depth': props.ancestors.length + 1 }"
      >
        <button type="button" class="rail-link" @click="open(c)">
          <span class="rail-name">{{ c.name }}</span>
          <span class="rail-label">{{ labelWord(c) }}</span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.map-rail {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}
.rail-up {
  display: inline-flex; align-items: center; gap: 8px; width: fit-content;
  padding: 6px 10px; margin-bottom: 2px;
  font-size: var(--text-sm); font-weight: var(--font-medium);
  color: var(--schools-fg-2, #555); text-decoration: none;
  border: 1px solid rgba(44, 38, 34, 0.12); border-radius: var(--radius-md, 8px);
  background: rgba(255, 255, 255, 0.5);
}
.rail-up:hover { background: rgba(255, 255, 255, 0.9); color: var(--schools-fg, #0F1212); }
.rail-up svg { flex-shrink: 0; color: var(--schools-red, #DB1E17); }

.rail-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.rail-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.rail-row { padding-left: calc(var(--depth, 0) * 14px); position: relative; }
.rail-row + .rail-row { margin-top: 2px; }

.rail-link, .rail-here, .rail-toggle {
  display: flex; align-items: baseline; gap: 8px; width: 100%;
  padding: 6px 10px; border: none; background: none; font: inherit; text-align: left;
  border-radius: var(--radius-md, 8px); min-width: 0;
}
.rail-link { cursor: pointer; color: var(--schools-fg-2, #555); }
.rail-link:hover { background: rgba(255, 255, 255, 0.72); color: var(--schools-fg, #0F1212); }
.rail-link:hover .rail-name { text-decoration: underline; }
/* Orientation-only rows: same shape, no click affordance. */
.rail-link.is-inert { cursor: default; }
.rail-link.is-inert:hover { background: none; color: var(--schools-fg-2, #555); }
.rail-link.is-inert:hover .rail-name { text-decoration: none; }

.rail-name {
  font-size: var(--text-sm); font-weight: var(--font-medium);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.rail-label { font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); flex-shrink: 0; }

.is-here .rail-here {
  background: rgba(var(--tone-red, 219 30 23), 0.07);
  border-left: 3px solid var(--schools-red, #DB1E17);
  border-radius: 0 var(--radius-md, 8px) var(--radius-md, 8px) 0;
}
.is-here .rail-name { font-weight: var(--font-bold, 700); color: var(--schools-fg, #0F1212); }
.is-here .rail-label { color: var(--schools-red, #DB1E17); font-weight: var(--font-medium); }

.rail-toggle { cursor: pointer; color: var(--schools-fg-3, #8A8078); font-size: var(--text-xs); padding: 4px 10px; }
.rail-toggle:hover { color: var(--schools-fg, #0F1212); }
.rail-sublist { list-style: none; margin: 0; padding: 0 0 0 14px; }

.is-child .rail-link::before {
  content: '└'; color: rgba(44, 38, 34, 0.25); font-size: var(--text-xs); flex-shrink: 0;
}
</style>
