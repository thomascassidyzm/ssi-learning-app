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
}>(), {
  ariaLabel: 'Select an option',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const activeIndex = ref(-1)
const rootEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
)
const selectedIndex = computed(() => props.options.findIndex((o) => o.value === props.modelValue))

function openMenu() {
  if (open.value) return
  open.value = true
  activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0
  nextTick(() => {
    const el = listEl.value?.querySelector<HTMLElement>(`[data-i="${activeIndex.value}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}
function closeMenu() {
  open.value = false
  activeIndex.value = -1
}
function toggle() { open.value ? closeMenu() : openMenu() }

function choose(i: number) {
  const opt = props.options[i]
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
  else if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex.value = Math.min(props.options.length - 1, activeIndex.value + 1); scrollActive() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex.value = Math.max(0, activeIndex.value - 1); scrollActive() }
  else if (e.key === 'Home') { e.preventDefault(); activeIndex.value = 0; scrollActive() }
  else if (e.key === 'End') { e.preventDefault(); activeIndex.value = props.options.length - 1; scrollActive() }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(activeIndex.value) }
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
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <span class="fs-value">{{ selectedLabel }}</span>
      <svg class="fs-chev" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <Transition name="fs-pop">
      <ul v-if="open" ref="listEl" class="fs-list" role="listbox" :aria-activedescendant="`fs-opt-${activeIndex}`">
        <li v-for="(opt, i) in options" :key="opt.value" role="presentation">
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
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-primary, #2c2622);
  text-align: left;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(12px) saturate(1.6);
  -webkit-backdrop-filter: blur(12px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
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
  font-family: var(--font-mono);
  font-size: 13px;
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

.fs-pop-enter-active, .fs-pop-leave-active { transition: opacity 130ms ease, transform 130ms ease; }
.fs-pop-enter-from, .fs-pop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.98); }

@media (prefers-reduced-transparency: reduce) {
  .fs-trigger { background: rgba(255, 255, 255, 0.96); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .fs-list { background: #ffffff; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-reduced-motion: reduce) {
  .fs-chev, .fs-pop-enter-active, .fs-pop-leave-active { transition: none; }
}
</style>
