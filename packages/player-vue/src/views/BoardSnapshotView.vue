<script setup lang="ts">
// ============================================================================
// BoardSnapshotView.vue — /board/:code. Public, unauthenticated. Renders ONE
// frozen board_snapshots row (living-board-report-spec.md §5) via
// GET /api/board/snapshot/:code — never a live query. A board member reads a
// dated document; nothing goes stale mid-meeting, nothing is queryable
// beyond this one row.
// ============================================================================
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { renderBoardMarkdown } from '@/utils/renderBoardMarkdown'
import BoardInlineSegments from '@/components/admin/BoardInlineSegments.vue'

const route = useRoute()

const label = ref('')
const reportMonth = ref('')
const markdown = ref('')
const resolvedMetrics = ref<Record<string, any>>({})
const frozenAt = ref<string | null>(null)
const isLoading = ref(true)
const notFound = ref(false)

const blocks = computed(() => renderBoardMarkdown(markdown.value, resolvedMetrics.value))

function formatFrozenAt(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

onMounted(async () => {
  const code = route.params.code as string
  try {
    const response = await fetch(`/api/board/snapshot/${code}`)
    if (!response.ok) {
      notFound.value = true
      return
    }
    const data = await response.json()
    label.value = data.label
    reportMonth.value = data.reportMonth
    markdown.value = data.markdown
    resolvedMetrics.value = data.resolvedMetrics || {}
    frozenAt.value = data.frozenAt
  } catch {
    notFound.value = true
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="board-snapshot-view">
    <div v-if="isLoading" class="loading">Loading…</div>

    <div v-else-if="notFound" class="not-found">
      <h1 class="arsenal">This board report link is no longer available.</h1>
      <p>It may have been revoked, or the link may be mistyped.</p>
    </div>

    <template v-else>
      <header class="snapshot-header">
        <span class="schools-kicker">Board report — {{ reportMonth }}</span>
        <h1 class="arsenal">{{ label }}</h1>
        <p class="frozen-note">Frozen {{ formatFrozenAt(frozenAt) }} — a dated snapshot, not a live view.</p>
      </header>

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
    </template>
  </div>
</template>

<style scoped>
.board-snapshot-view { max-width: 900px; margin: 0 auto; padding: 32px 20px 64px; }
.loading, .not-found { text-align: center; padding: var(--space-12, 48px) var(--space-6, 24px); color: var(--schools-fg-3, #8A8078); }
.not-found h1 { font-size: 24px; color: var(--ink-primary, #2C2622); margin-bottom: 8px; }

.snapshot-header { margin-bottom: 22px; }
.schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.snapshot-header h1 {
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.06;
  letter-spacing: -0.015em;
  color: var(--ink-primary, #2C2622);
  margin: 8px 0 8px;
}
.frozen-note { font-size: 14px; color: var(--schools-fg-3, #8A8078); margin: 0; }

.report-card { padding: var(--space-6, 24px) var(--space-8, 32px); }
.report-h1 { font-family: var(--font-display, 'Arsenal', serif); font-size: 26px; margin: 0 0 14px; }
.report-h2 { font-family: var(--font-display, 'Arsenal', serif); font-size: 21px; margin: 28px 0 10px; }
.report-h3 { font-family: var(--font-display, 'Arsenal', serif); font-size: 17px; margin: 20px 0 8px; }
.report-paragraph { font-size: 15px; line-height: 1.65; color: var(--schools-fg-2, #4a433d); margin: 0 0 14px; }
.report-list { margin: 0 0 14px; padding-left: 22px; font-size: 15px; line-height: 1.65; color: var(--schools-fg-2, #4a433d); }
.report-list li { margin-bottom: 6px; }
</style>
