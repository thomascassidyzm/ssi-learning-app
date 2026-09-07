<script setup lang="ts">
// FrostSelect — a styled, accessible dropdown that matches the Frostwell glass
// aesthetic. Replaces the native <select>, whose option list is OS-rendered (the
// ugly grey popup) and can't be themed. Trigger = a glass pill; the menu is a
// glass panel with a checkmark on the selection. Keyboard + click-outside +
// ARIA listbox semantics included.
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'

interface Option { value: string; label: string }

const props = withDefaults(defineProps<{
  modelValue: string
  options: Option[]
  ariaLabel?: string
  /** Show a search box at the top of the open menu. Standing estate rule:
   *  any list long enough to scan is filterable. Off by default so short
   *  lists (3-4 options) don't grow a pointless box. */
  filterable?: boolean
  filterPlaceholder?: string
  /** Shown on the trigger when nothing is selected yet. */
  placeholder?: string
  disabled?: boolean
}>(), {
  ariaLabel: 'Select an option',
  filterable: false,
  filterPlaceholder: 'Search…',
  placeholder: '',
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const activeIndex = ref(-1)
const query = ref('')
const rootEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
)

/** The options actually on screen — everything, unless a filter is typed. */
const visibleOptions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!props.filterable || !q) return props.options
  return props.options.filter((o) => o.label.toLowerCase().includes(q))
})
const selectedIndex = computed(() =>
  visibleOptions.value.findIndex((o) => o.value === props.modelValue),
)

function openMenu() {
  if (open.value || props.disabled) return
  open.value = true
  query.value = ''
  activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0
  nextTick(() => {
    if (props.filterable) searchEl.value?.focus()
    const el = listEl.value?.querySelector<HTMLElement>(`[data-i="${activeIndex.value}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}
function closeMenu() {
  open.value = false
  activeIndex.value = -1
  query.value = ''
}
function toggle() { open.value ? closeMenu() : openMenu() }

// Typing re-filters, so the highlight has to come back to the top of whatever
// is left — otherwise Enter picks a row that scrolled out from under it.
function onQueryInput() { activeIndex.value = 0 }

function choose(i: number) {
  const opt = visibleOptions.value[i]
  if (opt) emit('update:modelValue', opt.value)
  closeMenu()
}

function onTriggerKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); openMenu()
  }
}
function onListKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') { e.preventDefault(); closeMenu() }
  else if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex.value = Math.min(visibleOptions.value.length - 1, activeIndex.value + 1); scrollActive() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex.value = Math.max(0, activeIndex.value - 1); scrollActive() }
  else if (e.key === 'Home') { e.preventDefault(); activeIndex.value = 0; scrollActive() }
  else if (e.key === 'End') { e.preventDefault(); activeIndex.value = visibleOptions.value.length - 1; scrollActive() }
  else if (e.key === 'Enter') { e.preventDefault(); choose(activeIndex.value) }
  // Space is a character while a filter box has focus; only treat it as
  // "choose" when there is no search field to type into.
  else if (e.key === ' ' && !props.filterable) { e.preventDefault(); choose(activeIndex.value) }
}
function scrollActive() {
  nextTick(() => {
    listEl.value?.querySelector<HTMLElement>(`[data-i="${activeIndex.value}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

// Click-outside (capture on document while open).
function onDocPointer(e: PointerEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) closeMenu()
}
function watchOutside(on: boolean) {
  if (on) document.addEventListener('pointerdown', onDocPointer, true)
  else document.removeEventListener('pointerdown', onDocPointer, true)
}
// keep the listener in sync with open state
import { watch } from 'vue'
watch(open, watchOutside)
onBeforeUnmount(() => watchOutside(false))
</script>

<template>
  <div ref="rootEl" class="fs" @keydown="onListKey">
    <button
      type="button"
      class="fs-trigger"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      :disabled="disabled"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <span class="fs-value" :class="{ 'is-placeholder': !selectedLabel }">{{ selectedLabel || placeholder }}</span>
      <svg class="fs-chev" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <Transition name="fs-pop">
      <ul v-if="open" ref="listEl" class="fs-list" role="listbox" :aria-activedescendant="`fs-opt-${activeIndex}`">
        <li v-if="filterable" class="fs-search-row" role="presentation">
          <input
            ref="searchEl"
            v-model="query"
            type="text"
            class="fs-search"
            :placeholder="filterPlaceholder"
            :aria-label="filterPlaceholder"
            autocomplete="off"
            @input="onQueryInput"
          />
        </li>
        <li v-for="(opt, i) in visibleOptions" :key="opt.value" role="presentation">
          <button
            :id="`fs-opt-${i}`"
            type="button"
            class="fs-opt"
            :class="{ active: i === activeIndex, selected: opt.value === modelValue }"
            :data-i="i"
            role="option"
            :aria-selected="opt.value === modelValue"
            @click="choose(i)"
            @mousemove="activeIndex = i"
          >
            <span class="fs-check" aria-hidden="true">{{ opt.value === modelValue ? '✓' : '' }}</span>
            <span class="fs-opt-label">{{ opt.label }}</span>
          </button>
        </li>
        <li v-if="filterable && visibleOptions.length === 0" class="fs-empty" role="presentation">
          No matches for &ldquo;{{ query.trim() }}&rdquo;
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.fs { position: relative; }

/* Trigger — light glass pill (matches the controls bar) */
.fs-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 9px 12px;
  font-family: var(--fs-font, var(--font-mono));
  font-size: var(--fs-font-size, 13px);
  color: var(--ink-primary, #2c2622);
  text-align: left;
  background: var(--fs-bg, rgba(255, 255, 255, 0.5));
  backdrop-filter: blur(12px) saturate(1.6);
  -webkit-backdrop-filter: blur(12px) saturate(1.6);
  border: 1px solid var(--fs-border, rgba(255, 255, 255, 0.7));
  border-radius: var(--fs-radius, 12px);
  cursor: pointer;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.fs-trigger:disabled { cursor: not-allowed; opacity: 0.62; }
.fs-value.is-placeholder { color: var(--ink-tertiary, #8a827c); }
.fs-trigger:hover { border-color: rgba(var(--rc-entity, 96 165 250), 0.55); }
.fs-trigger:focus-visible {
  outline: none;
  border-color: rgba(var(--rc-entity, 96 165 250), 0.7);
  box-shadow: 0 0 0 3px rgba(var(--rc-entity, 96 165 250), 0.18);
}
.fs-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-chev { flex-shrink: 0; color: var(--rc-entity-ink, #2563eb); opacity: 0.75; transition: transform 160ms ease; }
.fs-chev.open { transform: rotate(180deg); }

/* Menu — glass panel */
.fs-list {
  position: absolute;
  z-index: 50;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  max-height: 300px;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(28px) saturate(1.8);
  -webkit-backdrop-filter: blur(28px) saturate(1.8);
  border: 1px solid rgba(44, 38, 34, 0.1);
  border-radius: 14px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    0 4px 12px rgba(44, 38, 34, 0.1),
    0 24px 60px rgba(44, 38, 34, 0.16);
}
.fs-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  font-family: var(--fs-font, var(--font-mono));
  font-size: var(--fs-font-size, 13px);
  color: var(--ink-secondary, #4a4440);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 9px;
  cursor: pointer;
}
.fs-opt.active { background: rgba(var(--rc-entity, 96 165 250), 0.12); color: var(--ink-primary, #2c2622); }
.fs-opt.selected { color: var(--rc-entity-ink, #2563eb); font-weight: 600; }
.fs-check { width: 14px; flex-shrink: 0; color: var(--rc-entity-ink, #2563eb); }
.fs-opt-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Search box — sits at the top of the open panel and stays there while the
   list below it scrolls. */
.fs-search-row {
  position: sticky;
  top: -6px;
  z-index: 1;
  margin: -6px -6px 0;
  padding: 6px;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 14px 14px 0 0;
}
.fs-search {
  width: 100%;
  padding: 8px 10px;
  font-family: var(--fs-font, var(--font-mono));
  font-size: var(--fs-font-size, 13px);
  color: var(--ink-primary, #2c2622);
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(44, 38, 34, 0.16);
  border-radius: 9px;
}
.fs-search:focus {
  outline: none;
  border-color: rgba(var(--rc-entity, 96 165 250), 0.7);
  box-shadow: 0 0 0 3px rgba(var(--rc-entity, 96 165 250), 0.16);
}
.fs-empty {
  padding: 10px;
  font-family: var(--fs-font, var(--font-mono));
  font-size: var(--fs-font-size, 13px);
  color: var(--ink-tertiary, #8a827c);
}

.fs-pop-enter-active, .fs-pop-leave-active { transition: opacity 130ms ease, transform 130ms ease; }
.fs-pop-enter-from, .fs-pop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.98); }

@media (prefers-reduced-transparency: reduce) {
  .fs-trigger { background: var(--fs-bg, rgba(255, 255, 255, 0.96)); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .fs-list { background: #ffffff; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-reduced-motion: reduce) {
  .fs-chev, /* Search box — sits at the top of the open panel and stays there while the
   list below it scrolls. */
.fs-search-row {
  position: sticky;
  top: -6px;
  z-index: 1;
  margin: -6px -6px 0;
  padding: 6px;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 14px 14px 0 0;
}
.fs-search {
  width: 100%;
  padding: 8px 10px;
  font-family: var(--fs-font, var(--font-mono));
  font-size: var(--fs-font-size, 13px);
  color: var(--ink-primary, #2c2622);
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(44, 38, 34, 0.16);
  border-radius: 9px;
}
.fs-search:focus {
  outline: none;
  border-color: rgba(var(--rc-entity, 96 165 250), 0.7);
  box-shadow: 0 0 0 3px rgba(var(--rc-entity, 96 165 250), 0.16);
}
.fs-empty {
  padding: 10px;
  font-family: var(--fs-font, var(--font-mono));
  font-size: var(--fs-font-size, 13px);
  color: var(--ink-tertiary, #8a827c);
}

.fs-pop-enter-active, .fs-pop-leave-active { transition: none; }
}
</style>
