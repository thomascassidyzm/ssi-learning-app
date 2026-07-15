<script setup lang="ts">
// ============================================================================
// BoardReportView.vue — /admin/board. The living board report
// (docs/board/living-board-report-spec.md): authored prose (git-tracked,
// docs/board/reports/<month>.md) wraps {{metric:...}} tokens that resolve to
// live DB values here, server-side, via GET /api/admin/board-metrics.
//
// WP-1: the live page, three metrics, current narrative + slot-9 appendix.
// WP-2: Freeze & share — mint a frozen board_snapshots row (all tokens
// resolved server-side) served at an unguessable /board/:code link.
//
// Static-imports the seed report (?raw — inlined at build time, same
// "rebuild to publish" model as public/docs/*.html). A report-month picker
// with dynamic loading is WP-5, deliberately deferred.
// ============================================================================
import { ref, computed, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { renderBoardMarkdown } from '@/utils/renderBoardMarkdown'
import { metricsBySlug, formatMetricValue, type ResolvedMetric } from '@/utils/boardTokens'
import BoardInlineSegments from '@/components/admin/BoardInlineSegments.vue'
import reportMarkdown from '../../../../../docs/board/reports/2026-07.md?raw'

const REPORT_MONTH = '2026-07'
const REPORT_LABEL_DEFAULT = 'July 2026 board report'

interface SnapshotRow {
  id: string
  created_at: string
  label: string
  report_month: string
  share_code: string
  revoked_at: string | null
  created_by: string
}

const { getAuthToken } = useAdminClient()

const metrics = ref<ResolvedMetric[]>([])
const isLoadingMetrics = ref(false)
const metricsError = ref<string | null>(null)

const snapshots = ref<SnapshotRow[]>([])
const isLoadingSnapshots = ref(false)
const freezeLabel = ref(REPORT_LABEL_DEFAULT)
const isFreezing = ref(false)
const freezeError = ref<string | null>(null)
const freezeSuccessUrl = ref<string | null>(null)
const copiedCode = ref<string | null>(null)
const revokingId = ref<string | null>(null)

const metricsMap = computed(() => metricsBySlug(metrics.value))
const blocks = computed(() => renderBoardMarkdown(reportMarkdown, metricsMap.value))

async function fetchMetrics(): Promise<void> {
  isLoadingMetrics.value = true
  metricsError.value = null
  try {
    const token = await getAuthToken()
    if (!token) { metricsError.value = 'Not authenticated'; return }
    const response = await fetch('/api/admin/board-metrics', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }
    const data = await response.json()
    metrics.value = data.metrics || []
  } catch (err: any) {
    metricsError.value = err.message || 'Failed to load board metrics'
  } finally {
    isLoadingMetrics.value = false
  }
}

async function fetchSnapshots(): Promise<void> {
  isLoadingSnapshots.value = true
  try {
    const token = await getAuthToken()
    if (!token) return
    const response = await fetch('/api/admin/board-snapshot', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    const data = await response.json()
    snapshots.value = data.snapshots || []
  } finally {
    isLoadingSnapshots.value = false
  }
}

async function freezeReport(): Promise<void> {
  if (!freezeLabel.value.trim()) {
    freezeError.value = 'Label is required'
    return
  }
  isFreezing.value = true
  freezeError.value = null
  freezeSuccessUrl.value = null
  try {
    const token = await getAuthToken()
    if (!token) { freezeError.value = 'Not authenticated'; return }
    const response = await fetch('/api/admin/board-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'freeze',
        label: freezeLabel.value.trim(),
        reportMonth: REPORT_MONTH,
        markdown: reportMarkdown,
      }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to freeze report')
    }
    const created = await response.json()
    freezeSuccessUrl.value = `${window.location.origin}/board/${created.share_code}`
    await fetchSnapshots()
  } catch (err: any) {
    freezeError.value = err.message || 'Failed to freeze report'
  } finally {
    isFreezing.value = false
  }
}

async function revokeSnapshot(id: string): Promise<void> {
  revokingId.value = id
  try {
    const token = await getAuthToken()
    if (!token) return
    const response = await fetch('/api/admin/board-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'revoke', id }),
    })
    if (response.ok) await fetchSnapshots()
  } finally {
    revokingId.value = null
  }
}

async function copyShareLink(shareCode: string): Promise<void> {
  const url = `${window.location.origin}/board/${shareCode}`
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    const el = document.createElement('textarea')
    el.value = url
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
  copiedCode.value = shareCode
  setTimeout(() => { if (copiedCode.value === shareCode) copiedCode.value = null }, 1800)
}

function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function snapshotStatus(s: SnapshotRow): { label: string; tone: 'green' | 'muted' } {
  return s.revoked_at ? { label: 'Revoked', tone: 'muted' } : { label: 'Live', tone: 'green' }
}

onMounted(() => {
  fetchMetrics()
  fetchSnapshots()
})
</script>

<template>
  <div class="board-report-view">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Living board report</span>
        <h1 class="arsenal">Board</h1>
        <p class="subtitle">
          Authored prose wraps live tokens — every number below is a real query against
          tonight's DB, not a hand-typed figure. Hover a bold number for its method and as-of time.
        </p>
      </div>
    </header>

    <Transition name="fade">
      <div v-if="metricsError" class="banner banner-error">{{ metricsError }}</div>
    </Transition>
    <div v-if="isLoadingMetrics" class="loading">Resolving live metrics…</div>

    <!-- Authored report, tokens resolved inline -->
    <article class="schools-card report-card">
      <template v-for="(block, i) in blocks" :key="i">
        <component
          :is="`h${block.kind === 'heading' ? block.level : 0}`"
          v-if="block.kind === 'heading'"
          :class="`report-heading report-h${block.level}`"
        >
          <BoardInlineSegments :segments="block.segments" />
        </component>

        <p v-else-if="block.kind === 'paragraph'" class="report-paragraph">
          <BoardInlineSegments :segments="block.segments" />
        </p>

        <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.kind === 'list'" class="report-list">
          <li v-for="(item, k) in block.items" :key="k">
            <BoardInlineSegments :segments="item" />
          </li>
        </component>
      </template>
    </article>

    <!-- Slot 9 — the appendix dashboard block: every registry metric, no narrative -->
    <section class="schools-card appendix-card">
      <div class="panel-head">
        <span class="schools-kicker">Appendix — the dashboard block</span>
        <p class="appendix-subtitle">Every metric in the registry, live, whether or not this month's report cites it.</p>
      </div>
      <div class="metric-grid">
        <div v-for="m in metrics" :key="m.slug" class="metric-tile">
          <div class="metric-tile-value frost-mono-nums">{{ formatMetricValue(m) }}</div>
          <div class="metric-tile-label">{{ m.label }}</div>
          <div class="metric-tile-method">{{ m.method }}</div>
          <div class="metric-tile-asof">as of {{ formatAsOf(m.asOf) }}</div>
        </div>
      </div>
    </section>

    <!-- Freeze & share -->
    <section class="schools-card freeze-card">
      <div class="panel-head">
        <span class="schools-kicker">Freeze &amp; share</span>
        <p class="appendix-subtitle">Mints a dated, frozen snapshot at an unguessable link — never live DB access for the reader.</p>
      </div>
      <form class="freeze-form" @submit.prevent="freezeReport">
        <input v-model="freezeLabel" type="text" class="frost-input" placeholder="Snapshot label" />
        <button type="submit" class="btn-primary" :disabled="isFreezing">
          <span v-if="isFreezing" class="spinner"></span>
          {{ isFreezing ? 'Freezing…' : 'Freeze & share' }}
        </button>
      </form>
      <Transition name="fade">
        <div v-if="freezeError" class="banner banner-error">{{ freezeError }}</div>
      </Transition>
      <Transition name="fade">
        <div v-if="freezeSuccessUrl" class="banner banner-success">Created: {{ freezeSuccessUrl }}</div>
      </Transition>

      <table v-if="snapshots.length > 0" class="links-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Created</th>
            <th>Status</th>
            <th>Link</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in snapshots" :key="s.id" :class="{ 'is-inactive': !!s.revoked_at }">
            <td class="cell-label">{{ s.label }}</td>
            <td class="cell-muted">{{ formatAsOf(s.created_at) }}</td>
            <td>
              <span class="status-pill" :class="`tone-${snapshotStatus(s).tone}`">
                <span class="status-dot"></span>{{ snapshotStatus(s).label }}
              </span>
            </td>
            <td>
              <button
                type="button"
                class="code-chip"
                :class="{ 'is-copied': copiedCode === s.share_code }"
                @click="copyShareLink(s.share_code)"
              >
                <span class="code-value">{{ copiedCode === s.share_code ? 'Copied!' : `/board/${s.share_code}` }}</span>
              </button>
            </td>
            <td class="cell-actions">
              <button
                v-if="!s.revoked_at"
                type="button"
                class="row-action row-action-danger"
                :disabled="revokingId === s.id"
                title="Revoke"
                @click="revokeSnapshot(s.id)"
              >✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!isLoadingSnapshots" class="empty-copy"><em>No snapshots minted yet.</em></p>
    </section>
  </div>
</template>

<style scoped>
.board-report-view { max-width: 900px; margin: 0 auto; }
.page-header { margin-bottom: 22px; }
.schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.page-header h1 {
  font-size: clamp(30px, 4vw, 44px);
  line-height: 1.04;
  letter-spacing: -0.015em;
  color: var(--ink-primary, #2C2622);
  margin: 8px 0 10px;
}
.subtitle {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  max-width: 64ch;
  margin: 0;
}

.report-card { padding: var(--space-6, 24px) var(--space-8, 32px); margin-bottom: 24px; }
.report-h1 { font-family: var(--font-display, 'Arsenal', serif); font-size: 26px; margin: 0 0 14px; }
.report-h2 { font-family: var(--font-display, 'Arsenal', serif); font-size: 21px; margin: 28px 0 10px; }
.report-h3 { font-family: var(--font-display, 'Arsenal', serif); font-size: 17px; margin: 20px 0 8px; }
.report-paragraph { font-size: 15px; line-height: 1.65; color: var(--schools-fg-2, #4a433d); margin: 0 0 14px; }
.report-list { margin: 0 0 14px; padding-left: 22px; font-size: 15px; line-height: 1.65; color: var(--schools-fg-2, #4a433d); }
.report-list li { margin-bottom: 6px; }

.appendix-card, .freeze-card { padding: 0; overflow: hidden; margin-bottom: 24px; }
.panel-head { padding: var(--space-4, 16px) var(--space-6, 24px) var(--space-3, 12px); border-bottom: 1px solid rgba(44, 38, 34, 0.06); }
.appendix-subtitle { margin: 4px 0 0; font-size: 13px; color: var(--schools-fg-3, #8A8078); }

.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1px; background: rgba(44, 38, 34, 0.06); }
.metric-tile { background: var(--schools-card, #fff); padding: var(--space-5, 20px) var(--space-6, 24px); }
.metric-tile-value { font-size: 28px; font-weight: var(--font-bold, 700); color: var(--ink-primary, #2C2622); }
.metric-tile-label { font-size: 13px; font-weight: var(--font-medium, 500); color: var(--schools-fg, #2C2622); margin-top: 4px; }
.metric-tile-method { font-size: 12px; color: var(--schools-fg-3, #8A8078); margin-top: 6px; line-height: 1.4; }
.metric-tile-asof { font-size: 11px; color: var(--schools-fg-3, #8A8078); margin-top: 6px; font-family: var(--font-mono, 'Spline Sans Mono', monospace); }

.freeze-form { display: flex; gap: 12px; padding: var(--space-5, 20px) var(--space-6, 24px); }
.freeze-form .frost-input { flex: 1; }

.banner { margin: 0 var(--space-6, 24px) var(--space-4, 16px); padding: 10px 14px; border-radius: var(--radius-lg, 10px); font-size: var(--text-sm, 13px); }
.banner-success { background: rgba(var(--tone-green, 63, 145, 90), 0.10); border: 1px solid rgba(var(--tone-green, 63, 145, 90), 0.28); color: rgb(var(--tone-green, 63, 145, 90)); }
.banner-error { background: rgba(var(--tone-red, 194, 58, 58), 0.08); border: 1px solid rgba(var(--tone-red, 194, 58, 58), 0.28); color: rgb(var(--tone-red, 194, 58, 58)); }

.frost-input {
  font: inherit;
  font-size: var(--text-base, 15px);
  padding: 10px 14px;
  color: var(--schools-fg, #2C2622);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg, 10px);
}
.frost-input:focus { outline: none; border-color: rgba(var(--tone-red, 194, 58, 58), 0.55); box-shadow: 0 0 0 3px rgba(var(--tone-red, 194, 58, 58), 0.14); }

.btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 18px; font: inherit; font-size: var(--text-sm, 13px); font-weight: var(--font-semibold, 600);
  border-radius: var(--radius-full, 999px); border: 1px solid transparent;
  background: var(--schools-red, #DB1E17); color: #fff; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.links-table { width: 100%; border-collapse: collapse; }
.links-table thead th {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace); font-size: 10px; font-weight: var(--font-medium, 500);
  letter-spacing: 0.14em; text-transform: uppercase; text-align: left; color: var(--schools-fg-3, #8A8078);
  padding: 12px 18px; border-bottom: 1px solid rgba(44, 38, 34, 0.08); background: rgba(255,255,255,0.35);
}
.links-table td { padding: 10px 18px; border-bottom: 1px solid rgba(44, 38, 34, 0.05); font-size: var(--text-sm, 13px); color: var(--schools-fg-2, #4a433d); }
.links-table tr.is-inactive { opacity: 0.5; }
.links-table tbody tr:last-child td { border-bottom: none; }
.cell-label { color: var(--schools-fg, #2C2622); font-weight: var(--font-medium, 500); }
.cell-muted { color: var(--schools-fg-3, #8A8078); white-space: nowrap; }
.cell-actions { text-align: right; }

.code-chip {
  display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px;
  background: rgba(255,255,255,0.55); border: 1px solid rgba(44,38,34,0.08); border-radius: var(--radius-md, 8px);
  font: inherit; cursor: pointer; color: var(--schools-fg-2, #4a433d);
}
.code-chip.is-copied { background: rgba(var(--tone-green, 63, 145, 90), 0.16); border-color: rgba(var(--tone-green, 63, 145, 90), 0.45); color: rgb(var(--tone-green, 63, 145, 90)); }
.code-value { font-size: var(--text-sm, 13px); }

.status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--radius-full, 999px); font-size: var(--text-xs, 11px); font-weight: var(--font-medium, 500); border: 1px solid transparent; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.status-pill.tone-green { color: rgb(var(--tone-green, 63, 145, 90)); background: rgba(var(--tone-green, 63, 145, 90), 0.10); border-color: rgba(var(--tone-green, 63, 145, 90), 0.30); }
.status-pill.tone-muted { color: var(--schools-fg-3, #8A8078); background: rgba(44, 38, 34, 0.04); border-color: rgba(44, 38, 34, 0.10); }

.row-action {
  width: 28px; height: 28px; display: grid; place-items: center; background: transparent;
  border: 1px solid transparent; border-radius: var(--radius-md, 8px); color: var(--schools-fg-3, #8A8078); cursor: pointer;
}
.row-action-danger:hover { color: rgb(var(--tone-red, 194, 58, 58)); background: rgba(var(--tone-red, 194, 58, 58), 0.08); border-color: rgba(var(--tone-red, 194, 58, 58), 0.25); }

.empty-copy { padding: var(--space-6, 24px); color: var(--schools-fg-3, #8A8078); }
.loading { text-align: center; padding: var(--space-8, 32px); color: var(--schools-fg-3, #8A8078); }

.fade-enter-active, .fade-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
