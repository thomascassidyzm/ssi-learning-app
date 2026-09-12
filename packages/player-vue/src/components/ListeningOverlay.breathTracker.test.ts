/**
 * ListeningOverlay — the Immersion breath-group tracker is IMMERSION ONLY
 * (job #408, Tom 2026-09-12: "I think we use this feature for Immersion
 * only, where the only tracker is the target sentence").
 *
 * Drill and every other sentence card must be untouched. The overlay's
 * `<script setup>` cannot be imported, so this pins the contract at the
 * source: the tracker branch is guarded by trackerGroupsFor, whose first
 * line refuses anything but an Immersion dialogue scene, and the Drill
 * fusion-strip block — the branch that renders before it — is byte-for-byte
 * what it was before the tracker existed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { breathGroupsForClip } from '../playback/breathGroups'

const src = readFileSync(fileURLToPath(new URL('./ListeningOverlay.vue', import.meta.url)), 'utf8')

// The Drill fusion-strip branch, verbatim as of dev before job #408.
const DRILL_STRIP_BLOCK = `            <template v-if="isCurrent && fusionStripsFor(phrase)">
              <div
                v-for="(strip, si) in fusionStripsFor(phrase)"
                :key="si"
                class="phrase-pair fusion-strip"
                :class="{ active: si === activeStripIndex }"
              >
                <div :lang="courseTargetLang" class="phrase-target" :dir="dirFor(strip.target)">{{ strip.target }}</div>
                <div :lang="courseKnownLang" v-if="showGloss && strip.known" class="phrase-known interleaved" :dir="dirFor(strip.known)">{{ strip.known }}</div>
              </div>
            </template>`

describe('ListeningOverlay — breath-group tracker scope', () => {
  it('renders the Drill fusion strips byte-identically to before the tracker', () => {
    expect(src.includes(DRILL_STRIP_BLOCK)).toBe(true)
  })

  it('guards the tracker branch with trackerGroupsFor, after the Drill branch', () => {
    const drillAt = src.indexOf(DRILL_STRIP_BLOCK)
    const trackerAt = src.indexOf('<template v-else-if="isCurrent && trackerGroupsFor(phrase)">')
    expect(trackerAt).toBeGreaterThan(drillAt)
  })

  it('trackerGroupsFor refuses anything but an Immersion dialogue scene on its first line', () => {
    const fn = src.slice(src.indexOf('const trackerGroupsFor = (phrase) => {'))
    const firstLine = fn.split('\n')[1].trim()
    expect(firstLine).toBe('if (!inImmersionScene.value) return null')
    expect(src).toContain("const inImmersionScene = computed(() => isDialogueScene.value && listenMode.value === 'immersion')")
  })

  it('a sentence with one breath group is null — the existing card, not a stack of one', () => {
    const oneBreath = { source: 'cartesia', words: ['Ciao', 'come', 'stai'], starts: [0.1, 0.5, 0.7], ends: [0.45, 0.68, 1.0] }
    expect(breathGroupsForClip(oneBreath, 'Ciao, come stai?')).toBeNull()
    expect(breathGroupsForClip(null, 'Ciao, come stai?')).toBeNull()
  })

  it('immersion translations are off by default and the eye drives the immersion state, not the shared one', () => {
    expect(src).toContain("const immersionGloss = ref(localStorage.getItem('ssi-listening-gloss-immersion') === 'on')")
    expect(src).toContain('@click="toggleGloss"')
  })
})
