<script setup lang="ts">
/**
 * NavMoreMenu — shared grouped overflow menu for the top bars.
 *
 * One dropdown, N titled groups, each item an icon + label + one-line
 * description so a collapsed destination still tells you what it IS —
 * the whole point of collapsing is spending the bar's space on identity
 * (school/context name), not on nine flat labels.
 *
 * Styling is driven by CSS custom properties so the same component sits on
 * the dark admin bar and the white schools bar:
 *   --nvm-trigger-color / --nvm-trigger-hover-bg / --nvm-active-color
 * The panel itself is always light (readability wins over surface-matching).
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

export interface NavMenuItem {
  label: string
  to: string
  /** One-line meaning shown under the label. */
  desc?: string
  /** SVG path `d` strings, rendered as 1.75px strokes on a 24px grid. */
  iconPaths?: string[]
  /** Route-active predicate; defaults to path-prefix match on `to`. */
  match?: (path: string) => boolean
}

export interface NavMenuGroup {
  label?: string
  items: NavMenuItem[]
}

const props = withDefaults(defineProps<{
  groups: NavMenuGroup[]
  triggerLabel: string
  /** Extra class hook for the trigger (e.g. the bar's own tab styling). */
  triggerClass?: string
  align?: 'left' | 'right'
}>(), {
  triggerClass: '',
  align: 'right',
})

const route = useRoute()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function itemActive(item: NavMenuItem): boolean {
  return item.match ? item.match(route.path) : route.path.startsWith(item.to)
}

/** True when the current route lives inside this menu — the trigger carries
 *  the active state so "where am I" survives the collapse. */
const containsActive = computed(() => props.groups.some((g) => g.items.some(itemActive)))

function toggle() { open.value = !open.value }
function close() { open.value = false }

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="nvm">
    <button
      type="button"
      class="nvm-trigger"
      :class="[triggerClass, { 'is-open': open, 'is-active': containsActive }]"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="nvm-trigger-label">{{ triggerLabel }}</span>
      <svg class="nvm-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <Transition name="nvm-pop">
      <div v-if="open" class="nvm-panel" :class="`nvm-panel--${align}`" role="menu">
        <div v-for="(group, gi) in groups" :key="gi" class="nvm-group">
          <div v-if="group.label" class="nvm-group-label">{{ group.label }}</div>
          <router-link
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="nvm-item"
            :class="{ active: itemActive(item) }"
            role="menuitem"
            @click="close"
          >
            <svg v-if="item.iconPaths?.length" class="nvm-item-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-for="(d, i) in item.iconPaths" :key="i" :d="d" />
            </svg>
            <span class="nvm-item-text">
              <span class="nvm-item-label">{{ item.label }}</span>
              <span v-if="item.desc" class="nvm-item-desc">{{ item.desc }}</span>
            </span>
          </router-link>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.nvm { position: relative; }

.nvm-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  color: var(--nvm-trigger-color, inherit);
}
.nvm-trigger:hover,
.nvm-trigger.is-open {
  background: var(--nvm-trigger-hover-bg, rgba(0, 0, 0, 0.05));
}
.nvm-trigger.is-active { color: var(--nvm-active-color, inherit); }

.nvm-caret { flex: none; transition: transform 140ms ease; }
.nvm-trigger.is-open .nvm-caret { transform: rotate(180deg); }

.nvm-panel {
  position: absolute;
  top: calc(100% + 8px);
  min-width: 264px;
  max-width: min(320px, calc(100vw - 24px));
  padding: 6px;
  background: #fff;
  border: 1px solid rgba(15, 18, 18, 0.1);
  border-radius: 12px;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.25);
  z-index: 80;
  color: #0f1212;
}
.nvm-panel--right { right: 0; }
.nvm-panel--left { left: 0; }

.nvm-group + .nvm-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(15, 18, 18, 0.07);
}
.nvm-group-label {
  padding: 7px 10px 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: rgba(15, 18, 18, 0.45);
}

.nvm-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  text-decoration: none;
  color: #0f1212;
}
.nvm-item:hover { background: rgba(15, 18, 18, 0.05); }
.nvm-item.active { background: rgba(219, 30, 23, 0.07); }
.nvm-item.active .nvm-item-label { color: var(--schools-red, #db1e17); }

.nvm-item-icon { flex: none; margin-top: 1px; color: rgba(15, 18, 18, 0.55); }
.nvm-item.active .nvm-item-icon { color: var(--schools-red, #db1e17); }

.nvm-item-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.nvm-item-label { font-size: 13.5px; font-weight: 600; line-height: 1.25; }
.nvm-item-desc { font-size: 11.5px; line-height: 1.35; color: rgba(15, 18, 18, 0.55); }

.nvm-pop-enter-active, .nvm-pop-leave-active { transition: opacity 140ms ease, transform 140ms ease; }
.nvm-pop-enter-from, .nvm-pop-leave-to { opacity: 0; transform: translateY(-4px); }

@media (prefers-reduced-motion: reduce) {
  .nvm-caret, .nvm-pop-enter-active, .nvm-pop-leave-active { transition: none; }
}
</style>
