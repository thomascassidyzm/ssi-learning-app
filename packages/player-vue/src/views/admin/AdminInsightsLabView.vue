<script setup lang="ts">
/**
 * /admin/insights-lab — THE DISPLAY LAB (job #26). A throwaway decision
 * instrument, not a product surface: one real rate-compare payload for the
 * Pune demo school, a dozen renderings of the same series side by side, one
 * tap per tile for like / unsure / no. Tom picks a visualisation by looking.
 *
 * Every tile carries the same three numbers for the chosen week so the tiles
 * are comparable and the drawing is what is being judged. One picker changes
 * the compare-to group for every tile at once; one switch changes the metric.
 * Verdicts go to the browser first, then to /api/lab/verdicts.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AdminTopBar from '@/components/admin/AdminTopBar.vue'
import { useAdminGate } from '@/composables/useAdminGate'
import { useAdminClient } from '@/composables/useAdminClient'
import LabRendering, { type Kind, type Series } from '@/lab/LabRendering.vue'
import { drainOutbox, latestFor, newVerdictId, recordVerdict, type LabVerdictWord } from '@/lab/labVerdicts'
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'

const { isCheckingAccess, isDenied } = useAdminGate()
const { getAuthToken } = useAdminClient()
const route = useRoute()

// The two entities the commission names, resolved live on 2026-09-16 from the
// demo school rows (Sunrise Public School, Pune — is_demo). Hardcoded here as
// the lab's DEFAULTS only; ?node=<id> overrides them.
const ENTITIES = [
  { id: '29692584-9edc-4f01-a421-3dcc8f8a2cdc', label: 'Grade 7A' },
  { id: '741e9b6e-9542-4ac4-9d28-e29471ceaf41', label: 'Sunrise' },
]

const KINDS: { kind: Kind; name: string }[] = [
  { kind: 'lines', name: 'Two lines' },
  { kind: 'anomaly', name: 'Weather line · above or below normal' },
  { kind: 'bars-line', name: 'Bars with a faint normal line' },
  { kind: 'paired', name: 'Paired bars' },
  { kind: 'multiples', name: 'Small multiples · both metrics' },
  { kind: 'heat', name: 'Heat strip' },
  { kind: 'dots', name: 'Dot strip' },
  { kind: 'running', name: 'Running total' },
  { kind: 'bignumber', name: 'One big number' },
  { kind: 'sentence', name: 'Just words' },
  { kind: 'slope', name: 'Last week to this week' },
  { kind: 'ribbon', name: 'Gap ribbon' },
]

const nodeId = ref<string>((route.query.node as string) || ENTITIES[0].id)
const compareTo = ref<string>('')
const metric = ref<'minutes' | 'phrases'>('minutes')
const window_ = ref<'this_week' | 'last_week'>('this_week')

interface WeekBlock {
  rangeLabel: string
  entity: { label: string; totalMinutes: number; newPhrases: number; hasData: boolean }
  cohort: { label: string; totalMinutes: number; newPhrases: number; size: number; sizeLabel: string } | null
  bars: { weeks: string[]; entity: Series; cohort: Series; entityPhrases?: Series; cohortPhrases?: Series }
}
interface Payload {
  node: { id: string; name: string }
  options: { compares: { value: string; label: string; word: string }[] }
  applied: { compare_to: string | null; window: string }
  week: WeekBlock | null
}

const payload = ref<Payload | null>(null)
const loading = ref(false)
const failure = ref<string | null>(null)
let seq = 0

async function load(): Promise<void> {
  const my = ++seq
  loading.value = true
  failure.value = null
  try {
    const token = await getAuthToken()
    if (!token) { failure.value = 'No session'; return }
    const qs = new URLSearchParams({ window: window_.value })
    if (compareTo.value) qs.set('compare_to', compareTo.value)
    const resp = await fetch(`/api/groups/${nodeId.value}/rate-compare?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
    if (my !== seq) return
    if (!resp.ok) { failure.value = `rate-compare answered ${resp.status}`; payload.value = null; return }
    const json = (await resp.json()) as Payload
    if (my !== seq) return
    payload.value = json
    if (json.applied?.compare_to && json.applied.compare_to !== compareTo.value) compareTo.value = json.applied.compare_to
  } catch (e) {
    if (my === seq) failure.value = e instanceof Error ? e.message : 'fetch failed'
  } finally {
    if (my === seq) loading.value = false
  }
}

function pickEntity(id: string): void {
  if (id === nodeId.value) return
  nodeId.value = id
  compareTo.value = '' // let the API choose the smallest container again
  void load()
}
watch([compareTo, window_], () => { void load() })

const week = computed(() => payload.value?.week ?? null)
const idx = computed(() => {
  const n = week.value?.bars.weeks.length ?? 12
  return window_.value === 'this_week' ? n - 1 : n - 2
})
const compares = computed(() => payload.value?.options.compares ?? [])
const compareLabel = computed(() => compares.value.find((c) => c.value === compareTo.value)?.label ?? null)
const cohortShort = computed(() => week.value?.cohort ? week.value.cohort.label.replace(/ average$/, '') : null)

const three = computed(() => {
  const w = week.value
  if (!w) return null
  const e = metric.value === 'minutes' ? w.entity.totalMinutes : w.entity.newPhrases
  const c = w.cohort ? (metric.value === 'minutes' ? w.cohort.totalMinutes : w.cohort.newPhrases) : null
  return { e: w.entity.hasData ? e : null, c, d: c === null || !w.entity.hasData ? null : Math.round((e - c) * 10) / 10 }
})
function fmt(v: number | null): string {
  if (typeof v !== 'number') return '—'
  if (metric.value === 'phrases') return `${Math.round(v)}`
  const m = Math.round(v)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
function fmtSigned(v: number | null): string {
  if (typeof v !== 'number') return '—'
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`
}

// ── verdicts ──
const counts = ref({ total: 0, waiting: 0 })
const notes = ref<Record<string, string>>({})
const tick = ref(0)
function given(kind: Kind): LabVerdictWord | null {
  void tick.value
  return latestFor({ rendering: kind, entityId: nodeId.value, compareTo: compareTo.value, metric: metric.value, window: window_.value })?.verdict ?? null
}
async function tap(kind: Kind, word: LabVerdictWord): Promise<void> {
  const w = week.value
  counts.value = await recordVerdict({
    id: newVerdictId(),
    madeAt: new Date().toISOString(),
    rendering: kind,
    verdict: word,
    note: (notes.value[kind] || '').trim() ? notes.value[kind] : null,
    entityId: nodeId.value,
    entityLabel: payload.value?.node.name ?? null,
    compareTo: compareTo.value,
    compareLabel: compareLabel.value,
    metric: metric.value,
    window: window_.value,
    weekLabel: w?.rangeLabel ?? null,
    build: typeof __BUILD_NUMBER__ === 'string' ? __BUILD_NUMBER__ : null,
    screen: three.value ? { entity: three.value.e, cohort: three.value.c, delta: three.value.d, cohortSize: w?.cohort?.size ?? null } : null,
  }, getAuthToken)
  tick.value++
}

onMounted(async () => {
  counts.value = await drainOutbox(getAuthToken)
  await load()
})
</script>

<template>
  <div class="schools-container schools-surface">
    <AdminTopBar />
    <div v-if="isCheckingAccess || isDenied" class="schools-loading"><div class="loading-spinner"></div></div>
    <main v-else class="lab">
      <div class="controls">
        <div class="seg">
          <button v-for="e in ENTITIES" :key="e.id" :class="{ on: nodeId === e.id }" @click="pickEntity(e.id)">{{ e.label }}</button>
        </div>
        <select v-model="compareTo" class="pick" :disabled="compares.length === 0">
          <option v-for="c in compares" :key="c.value" :value="c.value">vs {{ c.label }}</option>
        </select>
        <div class="row">
          <div class="seg">
            <button :class="{ on: metric === 'minutes' }" @click="metric = 'minutes'">minutes</button>
            <button :class="{ on: metric === 'phrases' }" @click="metric = 'phrases'">new phrases</button>
          </div>
          <div class="seg">
            <button :class="{ on: window_ === 'this_week' }" @click="window_ = 'this_week'">this week</button>
            <button :class="{ on: window_ === 'last_week' }" @click="window_ = 'last_week'">last week</button>
          </div>
        </div>
        <div class="status">
          <span v-if="loading">loading…</span>
          <span v-else-if="failure">{{ failure }}</span>
          <span v-else-if="week">{{ week.rangeLabel }}<template v-if="week.cohort"> · {{ week.cohort.sizeLabel }}</template></span>
          <span class="verdicts">{{ counts.total }} verdict{{ counts.total === 1 ? '' : 's' }}<template v-if="counts.waiting"> · {{ counts.waiting }} waiting</template></span>
        </div>
      </div>

      <p v-if="!loading && !failure && week && !week.cohort" class="absent">No group to compare with here yet.</p>

      <section v-if="week && three" class="tiles">
        <article v-for="k in KINDS" :key="k.kind" class="tile" :data-rendering="k.kind">
          <header class="tile-head">
            <span class="tile-name">{{ k.name }}</span>
            <span class="nums">
              <b>{{ fmt(three.e) }}</b>
              <span class="sep">·</span>
              <span class="grp">{{ cohortShort ?? 'group' }} {{ fmt(three.c) }}</span>
              <span class="sep">·</span>
              <span :class="['delta', three.d === null ? '' : three.d >= 0 ? 'up' : 'down']">{{ fmtSigned(three.d) }}</span>
            </span>
          </header>
          <LabRendering
            :kind="k.kind"
            :weeks="week.bars.weeks"
            :entity="week.bars.entity"
            :cohort="week.bars.cohort"
            :entity-phrases="week.bars.entityPhrases ?? week.bars.weeks.map(() => null)"
            :cohort-phrases="week.bars.cohortPhrases ?? week.bars.weeks.map(() => null)"
            :idx="idx"
            :metric="metric"
            :entity-label="week.entity.label"
            :cohort-label="week.cohort?.label ?? null"
            :week-label="week.rangeLabel"
          />
          <footer class="tile-foot">
            <div class="taps">
              <button v-for="w in (['like', 'unsure', 'no'] as LabVerdictWord[])" :key="w" :class="['tap', w, { on: given(k.kind) === w }]" @click="tap(k.kind, w)">{{ w }}</button>
            </div>
            <input v-model="notes[k.kind]" class="note" type="text" placeholder="say it, if you want" />
          </footer>
        </article>
      </section>
    </main>
  </div>
</template>

<style scoped>
.schools-container { height: 100vh; overflow-y: auto; display: flex; flex-direction: column; background: var(--schools-bg, #f6f5f1); color: var(--schools-fg, #0F1212); }
.schools-loading { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
.loading-spinner { width: 32px; height: 32px; border: 3px solid rgba(15,18,18,.1); border-top-color: #DB1E17; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.lab { flex: 1; padding: 12px 12px calc(40px + env(safe-area-inset-bottom, 0px)); max-width: 1100px; margin: 0 auto; width: 100%; box-sizing: border-box; }
.controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.seg { display: inline-flex; background: rgba(44,38,34,.06); border-radius: 999px; padding: 3px; gap: 2px; }
.seg button { border: 0; background: transparent; padding: 7px 14px; border-radius: 999px; font-size: 14px; color: rgba(44,38,34,.7); cursor: pointer; }
.seg button.on { background: #fff; color: #2C2622; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.pick { font-size: 14px; padding: 9px 12px; border-radius: 10px; border: 1px solid rgba(44,38,34,.14); background: #fff; color: #2C2622; max-width: 100%; }
.status { display: flex; justify-content: space-between; font-size: 12px; color: rgba(44,38,34,.55); padding: 0 4px; }
.absent { font-size: 14px; color: rgba(44,38,34,.6); }
.tiles { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 760px) { .tiles { grid-template-columns: 1fr 1fr; } }
@media (min-width: 1100px) { .tiles { grid-template-columns: 1fr 1fr 1fr; } }
.tile { background: #fff; border-radius: 14px; padding: 12px 14px 10px; box-shadow: 0 1px 3px rgba(0,0,0,.06); display: flex; flex-direction: column; gap: 8px; }
.tile-head { display: flex; flex-direction: column; gap: 2px; }
.tile-name { font-size: 12px; color: rgba(44,38,34,.5); }
.nums { font-size: 15px; color: #2C2622; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.nums b { font-size: 20px; color: rgb(37,99,235); }
.sep { color: rgba(44,38,34,.3); }
.grp { color: rgba(44,38,34,.6); }
.delta.up { color: rgb(37,99,235); }
.delta.down { color: rgba(44,38,34,.6); }
.tile-foot { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.taps { display: flex; gap: 6px; }
.tap { flex: 1; border: 1px solid rgba(44,38,34,.14); background: #fff; border-radius: 10px; padding: 9px 0; font-size: 14px; color: rgba(44,38,34,.75); cursor: pointer; }
.tap.on.like { background: rgb(37,99,235); border-color: rgb(37,99,235); color: #fff; }
.tap.on.unsure { background: rgba(44,38,34,.12); color: #2C2622; }
.tap.on.no { background: #2C2622; border-color: #2C2622; color: #fff; }
.note { border: 0; border-bottom: 1px solid rgba(44,38,34,.14); background: transparent; font-size: 13px; padding: 6px 2px; color: #2C2622; }
.note::placeholder { color: rgba(44,38,34,.35); }
</style>
