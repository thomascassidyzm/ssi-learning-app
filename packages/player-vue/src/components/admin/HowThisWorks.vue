<script setup lang="ts">
// HowThisWorks — the self-explaining dashboard's reference surface
// (docs/self-explaining-dashboard.md §6). One quiet text link; tap → an
// inline card with the persona×place explanation from the compiled pack.
// Static data, zero requests, nothing opens uninvited.
import { ref, computed } from 'vue'
import pack from '@/explainer/pack.json'
import { walksFor, startWalk } from '@/walkthrough/useWalkthrough'

const props = defineProps<{ persona: 'admin' | 'leader'; kind: string }>()

// Quiet per-persona×place "Show me" links into the walkthrough pack
// (docs/walkthrough-engine-scout.md §3.4) — launched by tap only, never auto.
const walks = computed(() => walksFor(props.persona, 'node-home', props.kind))

const open = ref(false)
const text = computed<string | null>(() => {
  const byKind = (pack.explanations as Record<string, Record<string, string>>)[props.persona]
  return byKind?.[props.kind] ?? byKind?.group ?? null
})

// Markdown-lite: paragraphs + **bold**. The pack is repo-authored (compiled,
// reviewed) content, but escape anyway so the renderer never trusts input.
const html = computed(() => {
  if (!text.value) return ''
  const escaped = text.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, ' ')}</p>`)
    .join('')
})
</script>

<template>
  <div v-if="text" class="htw">
    <button type="button" class="htw-toggle" @click="open = !open">
      {{ open ? 'Close' : 'How this works' }}
    </button>
    <transition name="htw-fade">
      <div v-if="open" class="htw-card schools-card">
        <span class="schools-kicker">How this works</span>
        <!-- eslint-disable-next-line vue/no-v-html — pack content is compiled repo data, escaped above -->
        <div class="htw-body" v-html="html"></div>
        <div v-if="walks.length" class="htw-walks">
          <button
            v-for="w in walks" :key="w.id" type="button" class="htw-walk-link"
            :data-walk-offer="w.id"
            @click="startWalk(w.id)"
          >Show me — {{ w.title }}</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.htw { display: flex; flex-direction: column; gap: var(--space-3); }
.htw-toggle {
  align-self: flex-end; background: none; border: none; cursor: pointer; padding: 2px 4px;
  font: inherit; font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(44, 38, 34, 0.25);
}
.htw-toggle:hover { color: var(--schools-fg-2, #555); }
.htw-card { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.htw-card .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.htw-body { font-size: var(--text-sm); color: var(--schools-fg-2, #555); line-height: 1.6; }
.htw-body :deep(p) { margin: 0 0 10px; }
.htw-body :deep(p:last-child) { margin-bottom: 0; }
.htw-body :deep(strong) { color: var(--ink-primary, #2C2622); font-weight: var(--font-semibold); }
.htw-walks { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.htw-walk-link {
  background: none; border: none; cursor: pointer; padding: 2px 0;
  font: inherit; font-size: var(--text-xs); color: var(--schools-red, #DB1E17);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(219, 30, 23, 0.3);
}
.htw-walk-link:hover { text-decoration-color: currentColor; }
.htw-fade-enter-active, .htw-fade-leave-active { transition: opacity 0.15s ease; }
.htw-fade-enter-from, .htw-fade-leave-to { opacity: 0; }
</style>
