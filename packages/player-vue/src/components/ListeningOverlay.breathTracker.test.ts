// @vitest-environment node
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
import { resolve } from 'node:path'
import { breathGroupsForClip, textLinesForSentence } from '../playback/breathGroups'

// Node environment + __dirname, as ListeningOverlay.scope.test.ts does: under
// the default jsdom environment import.meta.url is an http: URL, and this
// file threw "The URL must be of scheme file" at load from the day #408
// landed until job #425 — none of its pins had ever run.
const src = readFileSync(resolve(__dirname, 'ListeningOverlay.vue'), 'utf8')

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

describe('ListeningOverlay — job #425 tidy', () => {
  const clickFn = () => src.slice(src.indexOf('const handlePhraseClick = (displayIndex) => {'), src.indexOf('/** Bottom-nav ‹ › while listening mode is open'))

  it('a tap reveals the line only while that card is SOUNDING; a tap on a silent card plays it, as before #408', () => {
    const fn = clickFn()
    expect(fn).toContain('if (inImmersionScene.value && isPlaying.value && displayIndex === currentIndex.value) {')
    // The fall-through is the pre-#408 handler verbatim: stop, then play from the tapped row.
    expect(fn).toContain('  stopPlayback()\n  playFromIndex(displayIndex)\n}')
  })

  it('paints the lit group\'s fill on an inline span so a wrapped line fills in reading order', () => {
    expect(src).toContain('><span class="breath-fill">{{ g.text }}</span></div>')
    expect(src).toContain('.phrase-row.current .phrase-target.breath-group.live .breath-fill {\n  color: transparent;\n  background-image: linear-gradient(')
    // No block-level text clip left behind: the block only carries --fill.
    expect(src).toContain('.phrase-row.current .phrase-target.breath-group.live {\n  --fill: 0%;\n}')
    expect(src).not.toContain('box-decoration-break: clone')
  })

  it('carries no dead audioMap ref', () => {
    expect(src).not.toContain('audioMap')
  })
})

describe('ListeningOverlay — job #430: untimed clips share the stack, cut from the text', () => {
  const fn = src.slice(src.indexOf('const trackerGroupsFor = (phrase) => {'), src.indexOf('// The clip clock:'))

  it('with timings the lines come from the audio; without, from the text — one function, two sources', () => {
    expect(fn).toContain('const timed = !!(s?.targetAudioId && normaliseWordTimings(s.wordTimings))')
    expect(fn).toContain('const groups = breathGroupsForClip(s.wordTimings, text)')
    expect(fn).toContain('const lines = textLinesForSentence(text)')
    expect(fn).toContain("stack = { lines: estimateLineTimings(lines), timed: false }")
  })

  it('an untimed stack walks at an estimate from the clip length and never paints a fill (job #468)', () => {
    // Tom, staging 2026-09-12: "The method pod doesn't seem to be loading
    // line by line" — the xAI method pod stacked but nothing lit or moved.
    expect(src).toContain('const progress = live && d > 0 ? trackClock.value / d : 0')
    expect(src).toContain('return trackPosition(stack.lines, progress)')
    expect(src).toContain("const breathStyle = (gi, timed) => (timed && gi === trackPos.value.index ?")
    expect(src).toContain(':style="breathStyle(gi, trackerGroupsFor(phrase).timed)"')
    expect(src).toContain('trackDuration.value = a && Number.isFinite(a.duration) ? (a.duration || 0) : 0')
    expect(src).toContain(':class="{ untimed: !trackerGroupsFor(phrase).timed }"')
    expect(src).not.toContain("if (!stack?.timed) return { index: -1, fill: 0 }")
  })

  it('a timed clip with one breath group is still the card, not a text-cut stack', () => {
    // The timed branch never falls back to the text: `timed` is decided by
    // the timings alone, and its null result is stored as the card.
    expect(fn).toContain('if (timed) {\n    const groups = breathGroupsForClip(s.wordTimings, text)\n    if (groups) stack = { lines: groups, timed: true }\n  } else {')
  })

  it('a single text line falls through to the existing card', () => {
    expect(textLinesForSentence('Es un poco frustrante cuando no puedo pensar rápido.')).toBeNull()
    expect(textLinesForSentence('Creo que lo estás haciendo muy bien. Estoy impresionado.')).toEqual(['Creo que lo estás haciendo muy bien.', 'Estoy impresionado.'])
  })
})

describe('ListeningOverlay — job #479: an untimed live line is lit in full, not just its first letter', () => {
  // Tom, staging 2026-09-13, Italian method pod: "It illuminates JUST the
  // first letter of a line / Then speaks the line / Then it emboldens the
  // whole line that just spoke and the first letter of the next one / So
  // it's offset by one". The tracker index was right; the paint was wrong:
  // #468 set no --fill on an untimed live line, and the timed gradient rule
  // painted it at the default 0% — dark for the first letter, dim after.
  const UNTIMED_LIVE_RULE = `.phrase-row.current .breath-stack.untimed .phrase-target.breath-group.live .breath-fill {
  color: var(--text-primary);
  background-image: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
}`

  it('paints the whole untimed live line in the card colour, dropping the gradient and the clip', () => {
    expect(src).toContain(UNTIMED_LIVE_RULE)
  })

  it('places the untimed rule after both timed gradient rules, so it wins in the rtl case too', () => {
    const rtlRuleAt = src.lastIndexOf('.phrase-target.breath-group.live .breath-fill {\n  background-image: linear-gradient(\n    270deg,')
    expect(rtlRuleAt).toBeGreaterThan(0)
    expect(src.indexOf(UNTIMED_LIVE_RULE)).toBeGreaterThan(rtlRuleAt)
  })

  it('leaves the timed fill byte-identical: gradient on the inline span, walking with --fill', () => {
    expect(src).toContain(`.phrase-row.current .phrase-target.breath-group.live {
  --fill: 0%;
}
.phrase-row.current .phrase-target.breath-group.live .breath-fill {
  color: transparent;
  background-image: linear-gradient(
    90deg,
    var(--text-primary) 0,
    var(--text-primary) calc(var(--fill) - 2%),
    var(--breath-dim) calc(var(--fill) + 2%),
    var(--breath-dim) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
}`)
    expect(src).toContain("const breathStyle = (gi, timed) => (timed && gi === trackPos.value.index ?")
  })
})
