<script setup lang="ts" generic="T extends string | number">
// FrostSelect — THE dropdown. One control for every pick-one-from-a-list on
// the site, learner app and schools/admin alike (Tom's ruling, 2026-09-14:
// no native <select> anywhere, and every dropdown filterable, even a short
// one). Trigger = a glass pill; the menu is a glass panel with a search box
// pinned to its top and a tick on the selected row. Focus lands in the search
// box on open, typing narrows the rows by case-insensitive substring, arrows
// and Enter pick, Escape closes. On a phone the panel measures the visual
// viewport — the part of the screen the keyboard has not covered — and opens
// upward when that is where the room is, so the list is never hidden behind
// the keyboard.
import { ref, computed, nextTick, onBeforeUnmount, watch } from 'vue'
import { useI18n } from '../composables/useI18n'

export interface FrostOption<V> { value: V; label: string; disabled?: boolean }

const props = withDefaults(defineProps<{
  modelValue: T | null
  options: FrostOption<T>[]
  ariaLabel?: string
  filterPlaceholder?: string
  /** Shown on the trigger when nothing is selected yet. */
  placeholder?: string
  disabled?: boolean
}>(), {
  ariaLabel: 'Select an option',
  filterPlaceholder: '',
  placeholder: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: T]
  open: []
  close: []
}>()

const { t } = useI18n()

const open = ref(false)
const activeIndex = ref(-1)
const query = ref('')
const rootEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)

/** Where the panel goes and how tall it may be — decided from the visual
 *  viewport each time it opens or the viewport changes (keyboard up/down). */
const dropUp = ref(false)
const panelMaxHeight = ref(300)

const searchPlaceholder = computed(
  () => props.filterPlaceholder || `${t('common.search', 'Search')}…`,
)

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
)

/** The options actually on screen — everything, unless a filter is typed. */
const visibleOptions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((o) => o.label.toLowerCase().includes(q))
})
const selectedIndex = computed(() =>
  visibleOptions.value.findIndex((o) => o.value === props.modelValue),
)

function firstEnabledFrom(start: number, step: 1 | -1): number {
  const opts = visibleOptions.value
  for (let i = start; i >= 0 && i < opts.length; i += step) {
    if (!opts[i].disabled) return i
  }
  return -1
}

const PANEL_MAX = 300
const PANEL_MIN = 160
const GAP = 8

function placePanel() {
  const root = rootEl.value
  if (!root) return
  const vv = window.visualViewport
  const viewTop = vv ? vv.offsetTop : 0
  const viewHeight = vv ? vv.height : window.innerHeight
  const rect = root.getBoundingClientRect()
  const below = viewTop + viewHeight - rect.bottom - GAP
  const above = rect.top - viewTop - GAP
  const up = below < PANEL_MIN && above > below
  dropUp.value = up
  panelMaxHeight.value = Math.max(PANEL_MIN / 2, Math.min(PANEL_MAX, up ? above : below))
}

function openMenu() {
  if (open.value || props.disabled) return
  open.value = true
  query.value = ''
  activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : firstEnabledFrom(0, 1)
  emit('open')
  nextTick(() => {
    placePanel()
    searchEl.value?.focus({ preventScroll: true })
    scrollActive()
    // Once the keyboard has risen the visual viewport shrinks; re-measure so
    // the panel sits in the part of the screen still showing.
    nextTick(() => listEl.value?.scrollIntoView({ block: 'nearest' }))
  })
}
function closeMenu() {
  if (!open.value) return
  open.value = false
  activeIndex.value = -1
  query.value = ''
  emit('close')
}
function toggle() { open.value ? closeMenu() : openMenu() }

// Typing re-filters, so the highlight has to come back to the top of whatever
// is left — otherwise Enter picks a row that scrolled out from under it.
function onQueryInput() { activeIndex.value = firstEnabledFrom(0, 1) }

function choose(i: number) {
  const opt = visibleOptions.value[i]
  if (!opt || opt.disabled) return
  emit('update:modelValue', opt.value)
  closeMenu()
  rootEl.value?.querySelector<HTMLElement>('.fs-trigger')?.focus({ preventScroll: true })
}

function move(step: 1 | -1) {
  const start = activeIndex.value < 0 ? (step === 1 ? 0 : visibleOptions.value.length - 1) : activeIndex.value + step
  const next = firstEnabledFrom(start, step)
  if (next >= 0) activeIndex.value = next
  scrollActive()
}

function onTriggerKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); openMenu()
  }
}
function onListKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); rootEl.value?.querySelector<HTMLElement>('.fs-trigger')?.focus({ preventScroll: true }) }
  else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Home') { e.preventDefault(); activeIndex.value = firstEnabledFrom(0, 1); scrollActive() }
  else if (e.key === 'End') { e.preventDefault(); activeIndex.value = firstEnabledFrom(visibleOptions.value.length - 1, -1); scrollActive() }
  else if (e.key === 'Enter') { e.preventDefault(); choose(activeIndex.value) }
  else if (e.key === 'Tab') { closeMenu() }
}
function scrollActive() {
  nextTick(() => {
    listEl.value?.querySelector<HTMLElement>(`[data-i="${activeIndex.value}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

// Click-outside (capture on document while open) + viewport tracking.
function onDocPointer(e: PointerEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) closeMenu()
}
function watchOutside(on: boolean) {
  const vv = window.visualViewport
  if (on) {
    document.addEventListener('pointerdown', onDocPointer, true)
    vv?.addEventListener('resize', placePanel)
    vv?.addEventListener('scroll', placePanel)
    window.addEventListener('resize', placePanel)
  } else {
    document.removeEventListener('pointerdown', onDocPointer, true)
    vv?.removeEventListener('resize', placePanel)
    vv?.removeEventListener('scroll', placePanel)
    window.removeEventListener('resize', placePanel)
  }
}
watch(open, watchOutside)
onBeforeUnmount(() => watchOutside(false))

defineExpose({ open: openMenu, close: closeMenu })
</script>

<template>
  <div ref="rootEl" class="fs" :class="{ 'fs-open': open }">
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
      <span class="fs-value" :class="{ 'is-placeholder': !selectedLabel }">
        <slot name="value" :option="options.find((o) => o.value === modelValue)">{{ selectedLabel || placeholder }}</slot>
      </span>
      <svg class="fs-chev" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <Transition name="fs-pop">
      <div
        v-if="open"
        ref="listEl"
        class="fs-panel"
        :class="{ 'fs-panel-up': dropUp }"
        :style="{ maxHeight: panelMaxHeight + 'px' }"
        @keydown="onListKey"
      >
        <div class="fs-search-row">
          <input
            ref="searchEl"
            v-model="query"
            type="text"
            class="fs-search"
            :placeholder="searchPlaceholder"
            :aria-label="searchPlaceholder"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="open"
            :aria-activedescendant="activeIndex >= 0 ? `fs-opt-${activeIndex}` : undefined"
            @input="onQueryInput"
          />
        </div>
        <ul class="fs-list" role="listbox">
          <li v-for="(opt, i) in visibleOptions" :key="String(opt.value)" role="presentation">
            <button
              :id="`fs-opt-${i}`"
              type="button"
              class="fs-opt"
              :class="{ active: i === activeIndex, selected: opt.value === modelValue, 'is-disabled': opt.disabled }"
              :data-i="i"
              role="option"
              :aria-selected="opt.value === modelValue"
              :aria-disabled="opt.disabled || undefined"
              :tabindex="-1"
              @click="choose(i)"
              @mousemove="!opt.disabled && (activeIndex = i)"
            >
              <span class="fs-check" aria-hidden="true">{{ opt.value === modelValue ? '✓' : '' }}</span>
              <span class="fs-opt-label"><slot name="option" :option="opt">{{ opt.label }}</slot></span>
            </button>
          </li>
          <li v-if="visibleOptions.length === 0" class="fs-empty" role="presentation">
            {{ t('common.noMatchesFor', 'No matches for “{query}”').replace('{query}', query.trim()) }}
          </li>
        </ul>
      </div>
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
.fs-value { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-chev { flex-shrink: 0; color: var(--rc-entity-ink, #2563eb); opacity: 0.75; transition: transform 160ms ease; }
.fs-chev.open { transform: rotate(180deg); }

/* Panel — glass, search pinned at the top, the list scrolls beneath it. */
.fs-panel {
  position: absolute;
  z-index: 50;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  min-width: min(220px, 100vw - 24px);
  display: flex;
  flex-direction: column;
  padding: 6px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(28px) saturate(1.8);
  -webkit-backdrop-filter: blur(28px) saturate(1.8);
  border: 1px solid rgba(44, 38, 34, 0.1);
  border-radius: 14px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    0 4px 12px rgba(44, 38, 34, 0.1),
    0 24px 60px rgba(44, 38, 34, 0.16);
}
.fs-panel-up { top: auto; bottom: calc(100% + 6px); }
.fs-list {
  margin: 0;
  padding: 0;
  list-style: none;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
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
.fs-opt.is-disabled { opacity: 0.45; cursor: not-allowed; }
.fs-check { width: 14px; flex-shrink: 0; color: var(--rc-entity-ink, #2563eb); }
.fs-opt-label { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fs-search-row { flex-shrink: 0; padding: 0 0 6px; }
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
/* A phone zooms the page into any input under 16px; keep the search at 16px
   on touch screens so opening a dropdown never jolts the layout. */
@media (pointer: coarse) {
  .fs-search { font-size: 16px; }
}
.fs-empty {
  padding: 10px;
  font-family: var(--fs-font, var(--font-mono));
  font-size: var(--fs-font-size, 13px);
  color: var(--ink-tertiary, #8a827c);
}

.fs-pop-enter-active, .fs-pop-leave-active { transition: opacity 130ms ease, transform 130ms ease; }
.fs-pop-enter-from, .fs-pop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.98); }
.fs-panel-up.fs-pop-enter-from, .fs-panel-up.fs-pop-leave-to { transform: translateY(6px) scale(0.98); }

@media (prefers-reduced-transparency: reduce) {
  .fs-trigger { background: var(--fs-bg, rgba(255, 255, 255, 0.96)); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .fs-panel { background: #ffffff; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-reduced-motion: reduce) {
  .fs-chev { transition: none; }
  .fs-pop-enter-active, .fs-pop-leave-active { transition: none; }
}
</style>
