<script setup lang="ts">
/**
 * OrgFunderNumbers — the funded org's own monthly return, on its own node home.
 *
 * WHY THIS EXISTS (job #572). The whole org-enrolment chain shipped without a
 * leader-facing face: the funder numbers were real, correct and reachable only
 * by an ssi_admin holding a bearer token. The org that the numbers are ABOUT
 * had to ask us for them. That is the thing being closed.
 *
 * NOTHING NEW BEHIND IT. GET /api/org/funder-export already answers to
 * "ssi_admin, or the leader of the group, or of an ancestor of it" — the same
 * resolveGroupTreeCaller / callerCanSeeGroup pair the node home itself uses.
 * So this component adds a face, not a permission: a leader who could not read
 * these numbers before still cannot, and the check that says so lives on the
 * server, per request, as it did yesterday. No RLS policy was written for any
 * of it — hierarchy authz lives in endpoints, deliberately.
 *
 * WHAT IT SHOWS, AND WHAT IT WILL NOT. Exactly the export: counts, thresholds
 * and averages over three windows, with the 16-24 tick reported as a cohort
 * SIZE. There is no learner list, no name, no email and no per-person row here
 * — the export refuses to produce them, and that refusal is the reason the age
 * question could be a tick rather than a birth date. A leader wanting to know
 * who specifically has been quiet is a DIFFERENT surface and a different
 * conversation, not a column to add here.
 */
import { computed, ref, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{ nodeId: string; orgName?: string | null }>()

const { getAuthToken } = useAdminClient()
const { t } = useI18n()

interface Measures {
  registered: number
  overFiveMinutes: number
  overSixtyMinutes: number
  overHundredMinutes: number
  averageMinutesAll: number
  averageMinutesOverThree: number
  learnersOverThreeMinutes: number
  totalMinutes: number
}
interface WindowResult {
  window: { from: string; to: string; label: string }
  all: Measures
  aged16to24: Measures
}

/**
 * The previous COMPLETE month — the same default the endpoint applies, stated
 * here too so the month field shows what is about to be fetched rather than
 * sitting blank until the answer lands. A report pulled on the 3rd should not
 * be a stub of the 3rd.
 */
function previousMonth(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const month = ref(previousMonth())
const isLoading = ref(false)
const error = ref<string | null>(null)
const report = ref<{
  org: string | null
  month: string
  baselineFrom: string
  generatedAt: string
  minutesDefinition: string
  windows: WindowResult[]
  unmappedCourseCodes: string[]
} | null>(null)
const downloading = ref(false)

const title = computed(() => report.value?.org || props.orgName || t('org.ui.funder.funderReport', 'Funder report'))

/** Human labels for the three windows the export always returns, in its order. */
function windowLabel(w: WindowResult, index: number): string {
  if (index === 0) return t('org.ui.funder.thisMonth', 'The month you asked for')
  if (index === 1) return t('org.ui.funder.allTime', 'Since people enrolled')
  return t('org.ui.funder.sinceBaseline', 'Since {date}').replace('{date}', w.window.from)
}

async function load(): Promise<void> {
  if (!props.nodeId) return
  isLoading.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/org/funder-export?groupId=${encodeURIComponent(props.nodeId)}&month=${encodeURIComponent(month.value)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      error.value = (data as any)?.error || t('org.ui.funder.couldNotLoad', 'Could not load the numbers just now.')
      report.value = null
      return
    }
    // Normalised on arrival, never trusted field-by-field at render time: a
    // truncated or unexpected body must leave an empty panel, not a component
    // that throws mid-render and takes the rest of the page down with it.
    report.value = {
      ...(data as any),
      windows: Array.isArray((data as any)?.windows) ? (data as any).windows : [],
      unmappedCourseCodes: Array.isArray((data as any)?.unmappedCourseCodes) ? (data as any).unmappedCourseCodes : [],
      minutesDefinition: String((data as any)?.minutesDefinition || ''),
    }
  } catch {
    error.value = t('org.ui.funder.couldNotLoad', 'Could not load the numbers just now.')
    report.value = null
  } finally {
    isLoading.value = false
  }
}

/**
 * The spreadsheet, from the SAME endpoint in CSV mode — never re-derived in
 * the browser from the numbers above. A funder return assembled twice is a
 * funder return that disagrees with itself.
 */
async function downloadCsv(): Promise<void> {
  if (downloading.value) return
  downloading.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/org/funder-export?groupId=${encodeURIComponent(props.nodeId)}&month=${encodeURIComponent(month.value)}&format=csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!resp.ok) {
      error.value = t('org.ui.funder.couldNotDownload', 'Could not build the spreadsheet just now.')
      return
    }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `funder-export-${month.value}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    error.value = t('org.ui.funder.couldNotDownload', 'Could not build the spreadsheet just now.')
  } finally {
    downloading.value = false
  }
}

watch(() => [props.nodeId, month.value], () => { void load() }, { immediate: true })

defineExpose({ load })
</script>

<template>
  <!-- HANDBOOK See and download your funder numbers
       section: seeing-progress
       roles: leader, admin
       place: node-home
       keywords: funder, report, numbers, minutes, monthly return, csv, download, registered, 16 to 24
       What it's for. The monthly return your funder asks for, on your own page,
       so you can read it or send it without asking us to pull it.
       Where it is. Your organisation's home page, the **Funder report** section.
       How you do it.
       1. Open your organisation's home page.
       2. The month shown is the last complete one. Change it to report on another.
       3. Read the three blocks: the month, everything since people enrolled, and
          the funding year so far.
       4. Tap **Download spreadsheet** to get the same figures as a CSV.
       Worth knowing. Minutes here are minutes the app was actually speaking to a
       learner, never time a screen sat open. Somebody who has studied both Welsh
       dialects is counted once, at their higher dialect, never the two added up.
       There are no names in this report and there never will be — the age
       question is a tick precisely so nobody has to hold a birth date.
       checked: dd1261dc.ed6d97d2
  -->
  <section class="funder-numbers schools-card schools-card-pad" data-walk="funder-numbers">
    <div class="funder-head">
      <span class="schools-kicker">{{ t('org.ui.funder.kicker', 'Funder report') }}</span>
      <span class="funder-org">{{ title }}</span>
    </div>

    <div class="funder-controls">
      <label class="funder-month">
        <span class="funder-month-label">{{ t('org.ui.funder.month', 'Month') }}</span>
        <input v-model="month" type="month" :max="previousMonth()" class="funder-month-input" />
      </label>
      <button
        type="button"
        class="funder-verb"
        :disabled="downloading || isLoading || !report"
        @click="downloadCsv"
      >
        {{ downloading ? t('org.ui.funder.building', 'Building…') : t('org.ui.funder.download', 'Download spreadsheet') }}
      </button>
    </div>

    <p v-if="error" class="funder-error" role="alert">{{ error }}</p>
    <p v-else-if="isLoading && !report" class="funder-quiet">{{ t('org.ui.funder.loading', 'Working out the numbers…') }}</p>

    <template v-if="report">
      <div v-for="(w, i) in report.windows" :key="w.window.label" class="funder-window">
        <div class="funder-window-head">
          <span class="funder-window-title">{{ windowLabel(w, i) }}</span>
          <span class="funder-window-range">{{ w.window.from }} → {{ w.window.to }}</span>
        </div>
        <div class="funder-cohorts">
          <div v-for="cohort in [
                 { key: 'all', label: t('org.ui.funder.everyone', 'Everyone'), m: w.all },
                 { key: 'aged', label: t('org.ui.funder.aged', 'Aged 16 to 24'), m: w.aged16to24 },
               ]"
               :key="cohort.key"
               class="funder-cohort">
            <span class="funder-cohort-label">{{ cohort.label }}</span>
            <dl class="funder-measures">
              <div class="funder-measure">
                <dt>{{ t('org.ui.funder.registered', 'Registered') }}</dt>
                <dd>{{ cohort.m.registered }}</dd>
              </div>
              <div class="funder-measure">
                <dt>{{ t('org.ui.funder.over5', 'Over 5 minutes') }}</dt>
                <dd>{{ cohort.m.overFiveMinutes }}</dd>
              </div>
              <div class="funder-measure">
                <dt>{{ t('org.ui.funder.over60', 'Over 60 minutes') }}</dt>
                <dd>{{ cohort.m.overSixtyMinutes }}</dd>
              </div>
              <div class="funder-measure">
                <dt>{{ t('org.ui.funder.over100', 'Over 100 minutes') }}</dt>
                <dd>{{ cohort.m.overHundredMinutes }}</dd>
              </div>
              <div class="funder-measure">
                <dt>{{ t('org.ui.funder.avgAll', 'Average minutes, everyone') }}</dt>
                <dd>{{ cohort.m.averageMinutesAll }}</dd>
              </div>
              <div class="funder-measure">
                <dt>{{ t('org.ui.funder.avgActive', 'Average minutes, over 3 minutes') }}</dt>
                <dd>{{ cohort.m.averageMinutesOverThree }}</dd>
              </div>
              <div class="funder-measure">
                <dt>{{ t('org.ui.funder.overThreeCount', 'People over 3 minutes') }}</dt>
                <dd>{{ cohort.m.learnersOverThreeMinutes }}</dd>
              </div>
              <div class="funder-measure">
                <dt>{{ t('org.ui.funder.totalMinutes', 'Total minutes') }}</dt>
                <dd>{{ cohort.m.totalMinutes }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <!-- Loud, never silent: a course the family map has never heard of would
           otherwise be dropped from every figure above without a word. -->
      <p v-if="report.unmappedCourseCodes.length" class="funder-warning" role="alert">
        {{ t('org.ui.funder.unmapped', 'These courses are not yet counted in the figures above: {codes}. Tell us and we will add them.').replace('{codes}', report.unmappedCourseCodes.join(', ')) }}
      </p>

      <p class="funder-note">{{ report.minutesDefinition }}</p>
    </template>
  </section>
</template>

<style scoped>
.funder-numbers {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.funder-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.funder-org {
  font-size: 0.9rem;
  color: var(--schools-fg-2, #5b6161);
}
.funder-controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.funder-month {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.funder-month-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--schools-fg-2, #5b6161);
}
.funder-month-input {
  padding: 8px 10px;
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.6);
  color: inherit;
  font: inherit;
}
.funder-verb {
  padding: 6px 12px;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-md);
  border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(255, 255, 255, 0.6);
  color: var(--schools-fg-2, #555);
  cursor: pointer;
}
.funder-verb:hover:not(:disabled) { background: rgba(44, 38, 34, 0.08); }
.funder-verb:disabled { opacity: 0.5; cursor: wait; }
.funder-window {
  border-top: 1px solid rgba(44, 38, 34, 0.12);
  padding-top: 12px;
}
.funder-window-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.funder-window-title {
  font-weight: 600;
}
.funder-window-range {
  font-size: 0.78rem;
  color: var(--schools-fg-2, #5b6161);
  font-variant-numeric: tabular-nums;
}
.funder-cohorts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}
.funder-cohort-label {
  display: block;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--schools-fg-2, #5b6161);
  margin-bottom: 6px;
}
.funder-measures {
  margin: 0;
  display: grid;
  gap: 4px;
}
.funder-measure {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.funder-measure dt {
  color: var(--schools-fg-2, #5b6161);
  font-size: 0.85rem;
}
.funder-measure dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.funder-note,
.funder-quiet {
  font-size: 0.8rem;
  color: var(--schools-fg-2, #5b6161);
  margin: 0;
}
.funder-error,
.funder-warning {
  font-size: 0.85rem;
  color: rgb(var(--tone-red));
  margin: 0;
}
</style>
