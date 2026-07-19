<script setup lang="ts">
// NodeMapRail — the MAP of the org with a visual indicator of where you are
// (docs/THE-VIEW.md §1.1). Ancestor path from the org root down to here,
// you-are-here lit, siblings one tap away, children below — the whole org
// navigable up/down from any node without leaving the page. Same rail at
// every level; this is the spine of THE VIEW.
import { ref } from 'vue'
import { useRouter } from 'vue-router'

export interface RailRef {
  id: string
  name: string
  label: string
  is_demo?: boolean
  hasSchool?: boolean
}

const props = defineProps<{
  ancestors: RailRef[]
  node: { id: string; name: string; label: string }
  siblings: RailRef[]
  children: RailRef[]
  /** 'class' renders the current node as a leaf (no child nav rows). */
  kind?: 'node' | 'class'
}>()

const router = useRouter()
const showSiblings = ref(false)

function open(ref_: RailRef): void {
  router.push(`/admin/groups/${ref_.id}`)
}

function labelWord(r: RailRef): string {
  if (r.hasSchool || r.label === 'school') return 'school'
  return r.label || 'group'
}
</script>

<template>
  <nav class="map-rail" aria-label="Organisation map">
    <span class="schools-kicker rail-kicker">Where you are</span>
    <ol class="rail-list">
      <li v-for="(a, i) in props.ancestors" :key="a.id" class="rail-row is-ancestor" :style="{ '--depth': i }">
        <button type="button" class="rail-link" @click="open(a)">
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
