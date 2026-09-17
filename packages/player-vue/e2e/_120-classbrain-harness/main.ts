/**
 * Course-journey-card harness — mounts the REAL ClassBrain with the REAL
 * stylesheet against a 300-chunk class, so the fold can be screenshotted at a
 * phone viewport. Not shipped: this entry is only built by the probe beside it.
 *
 * ?mode=truncated reproduces what the server used to send — the last 60 chunks
 * and the rest of the course thrown away — which is the before picture.
 * ?mode=full sends the whole reached stretch, which is what the server sends now.
 */
import { createApp, h } from 'vue'
import ClassBrain from '../../src/components/schools/shared/ClassBrain.vue'
import fixture from './fixture-300.json'
import '../../src/styles/design-tokens.css'
import '../../src/styles/schools-tokens.css'
import '../../src/styles/schools-design.css'

const params = new URLSearchParams(location.search)
const mode = params.get('mode') || 'full'
const p = JSON.parse(JSON.stringify(fixture)) as Record<string, any>

// A class in its first term: the axis is short, so nothing is folded and the
// card must look exactly as it always has.
if (mode === 'short') {
  const N = 22
  p.legos = p.legos.slice(0, N)
  p.events = p.events.filter((e: any) => e.fires.every((f: number) => f < N))
  p.introducedCount = N
  p.reachedSeed = p.legos[N - 1].seed
}
if (mode === 'truncated') {
  const MAX_AXIS = 60
  const axisTo = p.legos.length
  const axisFrom = Math.max(0, axisTo - MAX_AXIS)
  p.legos = p.legos.slice(axisFrom, axisTo)
  p.axisFrom = axisFrom
}

window.fetch = (async () => ({ ok: true, status: 200, json: async () => p })) as never

document.documentElement.setAttribute('data-theme', 'mist')
document.body.style.background = 'var(--schools-bg, #F7F4EF)'
createApp({
  render: () => h('div', { class: 'schools-surface', style: 'padding:12px;max-width:100vw' }, [
    h('div', { class: 'schools-card', style: 'padding:12px' }, [
      h(ClassBrain as any, { classId: 'harness', getToken: () => 'token' }),
    ]),
  ]),
}).mount('#app')
