<script setup lang="ts">
/**
 * Question 8 — where in the world are people using us, and on what.
 *
 * Devices and territories, one question because they are always asked
 * together. The answer is distinct real people over the last thirty days,
 * country by country, with the phone, tablet and desktop split and the
 * in-the-app or in-a-browser split inside each. Rows are countries; a
 * country row is a chip on this page, since a country is a lens over the
 * same numbers and never a page of its own. A device is a second lens, and
 * both live in the URL so a pasted address reproduces the view.
 */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import QuestionPage from '@/intel/QuestionPage.vue'
import InsightWidget from '@/insight/InsightWidget.vue'
import Chip from '@/intel/Chip.vue'
import { useIntelApi } from '@/intel/useIntelApi'
import { questionBySlug } from '@/intel/questions'
import { metric } from '@/intel/metrics'
import { singulariseUnit } from '@/insight/units'
import type { AnyInsightSpec, ResolvedInsight } from '@/insight/spec'

type Device = 'mobile' | 'tablet' | 'desktop' | 'unknown'
type Shell = 'web' | 'webview' | 'unknown'
interface CountryRow { country: string; people: number; byDevice: Record<Device, number>; byShell: Record<Shell, number> }
interface WhereAndWhatResponse {
  days: number
  population: number
  people: number
  countries: number
  rows: CountryRow[]
  devices: { device: Device; people: number }[]
  shells: { shell: Shell; people: number }[]
  shellRecordedSince: string
  kFloor: number
  tooFewToSay: boolean
  truncated: boolean
}

const question = questionBySlug('where-and-what')!
const route = useRoute()
const { data, error, fetchedAt, load } = useIntelApi<WhereAndWhatResponse>('/api/intel/where-and-what')
onMounted(() => { void load({ days: '30' }) })

const DEVICE_WORD: Record<Device, string> = { mobile: 'phones', tablet: 'tablets', desktop: 'desktops', unknown: 'device not stamped' }
const SHELL_WORD: Record<Shell, string> = { web: 'in a browser', webview: 'in the app', unknown: 'not recorded' }
const DEVICES: Device[] = ['mobile', 'tablet', 'desktop', 'unknown']

/** The two lenses, read from the URL. */
const country = computed(() => (typeof route.query.country === 'string' ? route.query.country : null))
const device = computed<Device | null>(() => (DEVICES.includes(route.query.device as Device) ? (route.query.device as Device) : null))

/** A count's own word: one person, not one people. */
function word(plural: string, n: number): string {
  return n === 1 ? singulariseUnit(plural) : plural
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en-GB'], { type: 'region' }) : null
function countryName(code: string): string {
  if (code === 'unknown') return 'country not stamped'
  try { return regionNames?.of(code) ?? code } catch { return code }
}

/** The number a row shows: the whole country, or that country on the chosen device. */
function shown(r: CountryRow): number {
  return device.value ? r.byDevice[device.value] : r.people
}

const answer = computed<string | null>(() => {
  if (error.value) return error.value
  const d = data.value
  if (!d) return null
  if (d.tooFewToSay) return `Fewer than ${d.kFloor} real people were seen in the last thirty days, too few to say where or on what.`
  const top = d.rows.find((r) => r.country !== 'unknown')
  const lead = top ? ` Most are in ${countryName(top.country)}.` : ''
  const mostDevice = [...d.devices].sort((a, b) => b.people - a.people)[0]
  const deviceLine = mostDevice && mostDevice.device !== 'unknown' ? ` Most use ${DEVICE_WORD[mostDevice.device]}.` : ''
  const app = d.shells.find((s) => s.shell === 'webview')?.people ?? 0
  const web = d.shells.find((s) => s.shell === 'web')?.people ?? 0
  const shellLine = app + web > 0 ? ` Of the people seen since ${sinceWord(d.shellRecordedSince)}, ${app} were in the app and ${web} in a browser.` : ''
  return `${d.people} real people used us from ${d.countries} ${d.countries === 1 ? 'country' : 'countries'} in the last thirty days.${lead}${deviceLine}${shellLine}`
})
const headline = computed(() => (data.value && !data.value.tooFewToSay ? String(data.value.people) : null))

function sinceWord(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

const spec = computed<AnyInsightSpec>(() => ({
  widget: 'ranked-bar',
  query: { metric: 'peopleByCountryMonth', window: '30d' },
  frame: 'world',
  title: metric('peopleByCountryMonth', question.slug).label,
  tag: device.value ? DEVICE_WORD[device.value] : 'countries',
}))
const resolved = computed<ResolvedInsight>(() => ({
  isLoading: !data.value && !error.value,
  error: error.value,
  data: {
    kind: 'ranked-bar',
    bars: (data.value?.rows ?? [])
      .filter((r) => r.country !== 'unknown' && shown(r) > 0)
      .sort((a, b) => shown(b) - shown(a))
      .slice(0, 12)
      .map((r) => ({ id: r.country, label: countryName(r.country), value: shown(r) })),
    unit: 'people',
    horizontal: true,
  },
}))

const rows = computed(() => {
  const all = data.value?.rows ?? []
  const narrowed = country.value ? all.filter((r) => r.country === country.value) : all
  return device.value ? [...narrowed].filter((r) => shown(r) > 0).sort((a, b) => shown(b) - shown(a)) : narrowed
})

/** The same page with one lens changed and the other kept. */
function lens(next: { country?: string | null; device?: Device | null }) {
  const q: Record<string, string> = {}
  const c = next.country === undefined ? country.value : next.country
  const dv = next.device === undefined ? device.value : next.device
  if (c) q.country = c
  if (dv) q.device = dv
  return { path: '/intel/where-and-what', query: q }
}

const deviceLine = computed(() => (data.value?.devices ?? []).map((d) => `${DEVICE_WORD[d.device]} ${d.people}`).join(' · '))
const shellLine = computed(() => (data.value?.shells ?? []).map((s) => `${SHELL_WORD[s.shell]} ${s.people}`).join(' · '))
</script>

<template>
  <!-- HANDBOOK Where in the world people are using us, and on what
       section: seeing-progress
       roles: admin
       place: intel
       keywords: where, country, territory, device, phone, tablet, desktop, app, browser, web
       What it's for. Which countries real people practised from in the last
       thirty days, whether they were on phones, tablets or desktops, and
       whether they were in the app or in a browser.
       Where it is. **Where and what**, under What's happening.
       How you do it.
       1. Read the sentence for how many real people, from how many
          countries, and the country and device most of them are on.
       2. Read the chart for people by country, most first.
       3. Read the rows, one per country, each with its phone, tablet and
          desktop split and its in-the-app or in-a-browser split. Tap a
          country to narrow the page to it; tap a device chip to count only
          that device. Both choices are written into the page address.
       Worth knowing. A person seen on two devices is counted once in the
       headline and once under each device. In the app or in a browser has
       only been recorded since 10 September 2026, so earlier people read as
       not recorded rather than being guessed at. Machine traffic is left out
       by rule.
       checked: 46cd398d.583b88f5
  -->
  <QuestionPage
    data-intel="question-where-and-what"
    :question="question.question"
    :answer="answer"
    :headline="headline"
    :fetched-at="fetchedAt"
    :people="data?.population ?? null"
  >
    <template #evidence>
      <InsightWidget :spec="spec" :resolved="resolved" />
    </template>

    <template #rows>
      <div class="rows-card">
        <div class="rows-head">
          <p class="rows-title">{{ metric('peopleByDevice', question.slug).label }}</p>
          <div class="lenses">
            <Chip v-if="country" :to="lens({ country: null })" :on="true">{{ countryName(country) }} · show all</Chip>
            <Chip v-for="d in (data?.devices ?? []).filter((x) => x.device !== 'unknown')" :key="d.device" :to="lens({ device: device === d.device ? null : d.device })" :on="device === d.device">{{ DEVICE_WORD[d.device] }}</Chip>
          </div>
        </div>
        <p v-if="data && rows.length === 0" class="rows-empty">Nobody was seen here in the last thirty days.</p>
        <router-link
          v-for="r in rows"
          :key="r.country"
          class="row"
          :to="lens({ country: r.country })"
        >
          <span class="who">
            <span class="name">{{ countryName(r.country) }}</span>
            <span v-if="r.country !== 'unknown'" class="code">{{ r.country }}</span>
          </span>
          <span class="values">
            <span class="cell"><span class="num">{{ shown(r) }}</span><span class="lbl">{{ word(device ? DEVICE_WORD[device] : 'people', shown(r)) }}</span></span>
            <span class="cell"><span class="num">{{ r.byDevice.mobile }}</span><span class="lbl">{{ word('phones', r.byDevice.mobile) }}</span></span>
            <span class="cell"><span class="num">{{ r.byDevice.tablet }}</span><span class="lbl">{{ word('tablets', r.byDevice.tablet) }}</span></span>
            <span class="cell"><span class="num">{{ r.byDevice.desktop }}</span><span class="lbl">{{ word('desktops', r.byDevice.desktop) }}</span></span>
            <span class="cell"><span class="num">{{ r.byShell.webview }}</span><span class="lbl">in the app</span></span>
            <span class="cell"><span class="num">{{ r.byShell.web }}</span><span class="lbl">browser</span></span>
          </span>
        </router-link>
        <p v-if="data && !data.tooFewToSay" class="totals">
          <span class="total-line">{{ deviceLine }}</span>
          <span class="total-line">{{ metric('peopleInAppOrWeb', question.slug).label }}: {{ shellLine }}. Recorded since {{ sinceWord(data.shellRecordedSince) }}.</span>
        </p>
        <p v-if="data?.truncated" class="rows-note">
          More events this month than one read can hold, so these counts are a floor rather than a total.
        </p>
      </div>
    </template>
  </QuestionPage>
</template>

<style scoped>
.rows-card {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg);
  overflow: hidden;
}
.rows-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-right: 14px; }
.rows-title {
  padding: 14px 18px 10px;
  margin: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red);
}
.lenses { display: flex; gap: 6px; flex-wrap: wrap; }
.rows-empty { padding: 0 18px 16px; color: var(--schools-fg-3); font-size: 14px; }
.rows-note { padding: 10px 18px 14px; margin: 0; font-size: 12px; color: var(--schools-fg-3); }
.totals { display: flex; flex-direction: column; gap: 4px; padding: 12px 18px 14px; margin: 0; border-top: 1px solid var(--schools-border); font-size: 12.5px; color: var(--schools-fg-2); }
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 18px;
  border-top: 1px solid var(--schools-border);
  color: var(--schools-fg);
  text-decoration: none;
}
.row:hover { background: var(--schools-bg); }
.who { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--schools-fg-3); }
.values { display: flex; gap: 12px; flex: none; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.cell { display: flex; flex-direction: column; align-items: flex-end; min-width: 4.5ch; }
.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 14px; }
.lbl { font-size: 10.5px; color: var(--schools-fg-3); white-space: nowrap; }
</style>
