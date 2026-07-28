/**
 * useWalkthrough — the walkthrough engine's runtime state machine
 * (docs/walkthrough-engine-scout.md §3). One module-level singleton, same
 * pattern as the other shared composables: any surface can offer a walk,
 * one WalkOverlay (mounted once in App.vue) renders whichever is active.
 *
 * Walks NEVER auto-play — startWalk only ever runs from a user tap on a
 * noticing-invitation CTA or a How-this-works "Show me" link. Walks run on
 * the REAL page over REAL data: show-and-point by default (advance "next"),
 * the user's own click advances "click" steps (the overlay listens, never
 * intercepts), and the compiler refuses click-advance on destructive verbs.
 *
 * Anchors are data-walk="<id>" attributes on real elements — resolution is
 * a live querySelector with a bounded wait; a step whose anchor never shows
 * within ANCHOR_TIMEOUT_MS renders unanchored with Next (a walkthrough must
 * never hang).
 */
import { ref, computed } from 'vue'
import pack from './pack.json'

// Semantic places a walk can live — the compiler gate checks every walk's
// place.route against this list (lockstep, like the explainer's KNOWN_TARGETS).
export const KNOWN_PLACES = ['node-home', 'class-detail', 'node-insights', 'admin-invites']

export type WalkPersona = 'admin' | 'leader' | 'school_admin' | 'teacher'

export interface WalkStep {
  anchor: string
  say: string
  advance: { on: 'next' | 'click' | 'visible' }
  terminal?: string
}

export interface Walk {
  id: string
  title: string
  personas: WalkPersona[]
  place: { route: string; kinds?: string[] }
  steps: WalkStep[]
}

export const ANCHOR_TIMEOUT_MS = 5000

const walks = (pack as { walks: Walk[] }).walks

const activeWalk = ref<Walk | null>(null)
const stepIndex = ref(0)
const showingTerminal = ref(false)

/** Walks offerable at a persona × place (× node kind, where the place has kinds). */
export function walksFor(persona: WalkPersona, place: string, kind?: string): Walk[] {
  return walks.filter((w) =>
    w.place.route === place &&
    w.personas.includes(persona) &&
    (!w.place.kinds || !kind || w.place.kinds.includes(kind)))
}

export function walkById(id: string): Walk | null {
  return walks.find((w) => w.id === id) ?? null
}

function stamp(): void {
  // DOM breadcrumb — the e2e harness asserts on this (prod strips console).
  const el = document.documentElement
  if (activeWalk.value) {
    el.setAttribute('data-walk-active', `${activeWalk.value.id}:${stepIndex.value}${showingTerminal.value ? ':done' : ''}`)
  } else {
    el.removeAttribute('data-walk-active')
  }
}

export function startWalk(id: string): boolean {
  const walk = walkById(id)
  if (!walk) return false
  activeWalk.value = walk
  stepIndex.value = 0
  showingTerminal.value = false
  stamp()
  return true
}

export function stopWalk(): void {
  activeWalk.value = null
  stepIndex.value = 0
  showingTerminal.value = false
  stamp()
}

function advance(): void {
  const walk = activeWalk.value
  if (!walk) return
  if (stepIndex.value < walk.steps.length - 1) {
    stepIndex.value += 1
  } else if (walk.steps[stepIndex.value]?.terminal && !showingTerminal.value) {
    showingTerminal.value = true
  } else {
    stopWalk()
    return
  }
  stamp()
}

function back(): void {
  if (showingTerminal.value) {
    showingTerminal.value = false
  } else if (stepIndex.value > 0) {
    stepIndex.value -= 1
  }
  stamp()
}

export function useWalkthrough() {
  return {
    activeWalk: computed(() => activeWalk.value),
    stepIndex: computed(() => stepIndex.value),
    showingTerminal: computed(() => showingTerminal.value),
    currentStep: computed<WalkStep | null>(() =>
      activeWalk.value ? activeWalk.value.steps[stepIndex.value] ?? null : null),
    startWalk,
    stopWalk,
    next: advance,
    back,
  }
}
