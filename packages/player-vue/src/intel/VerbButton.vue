<script setup lang="ts">
/**
 * VerbButton — one verb of the intelligence surface, confirm-first.
 *
 * Design §3.1: "A verb that writes anything confirms first and names what it
 * will change." docs/intelligence-surface-verbs.md: every verb exists exactly
 * once, calls the endpoint that already implements it, and the ENDPOINT
 * writes the audit row naming the human — never the page.
 *
 * So this component does three things and no more: shows the verb in plain
 * words, opens a confirm strip that says exactly what will change, and posts
 * to the one endpoint when confirmed. What happens to the data, and what is
 * recorded about it, is the endpoint's, and every endpoint is verifyAdmin-
 * gated. A result line reports what came back, in the same strip.
 *
 * Brand red is the primary verb's own colour — one of its three permitted
 * jobs. A destructive verb is not painted louder; it confirms harder, with
 * the word "back" or "away" in its confirm text.
 */
import { ref } from 'vue'
import { apiUrl } from '@/platform/apiBase'
import { useAdminClient } from '@/composables/useAdminClient'

const props = withDefaults(defineProps<{
  /** The verb, in plain words. */
  label: string
  /** What will change, said before anything does. */
  confirm: string
  endpoint: string
  body: Record<string, unknown>
  /** The word on the confirm button. */
  confirmWord?: string
  /** Secondary verbs are ink on card; the primary verb is brand red. */
  primary?: boolean
  /** Reads a field off the response to show, for verbs that return something to hand over. */
  result?: (body: Record<string, unknown>) => string
}>(), { confirmWord: 'Yes, do it', primary: false, result: undefined })

const emit = defineEmits<{ done: [body: Record<string, unknown>] }>()

const { getAuthToken } = useAdminClient()
const open = ref(false)
const busy = ref(false)
const outcome = ref<string | null>(null)
const failed = ref(false)

async function run(): Promise<void> {
  busy.value = true
  outcome.value = null
  failed.value = false
  try {
    const token = await getAuthToken()
    const res = await fetch(apiUrl(props.endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(props.body),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      failed.value = true
      outcome.value = typeof body.error === 'string' ? body.error : 'That did not work.'
      return
    }
    outcome.value = props.result ? props.result(body) : 'Done.'
    emit('done', body)
  } catch {
    failed.value = true
    outcome.value = 'Could not reach the server.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <span class="verb" data-intel-shape="verb">
    <button type="button" class="verb-btn" :class="{ primary }" :disabled="busy" @click="open = !open">{{ label }}</button>
    <span v-if="open" class="confirm">
      <span class="what">{{ confirm }}</span>
      <button type="button" class="verb-btn primary small" :disabled="busy" @click="run">{{ busy ? 'Working…' : confirmWord }}</button>
      <button type="button" class="verb-btn small" :disabled="busy" @click="open = false">Not now</button>
      <span v-if="outcome" class="outcome" :class="{ failed }">{{ outcome }}</span>
    </span>
  </span>
</template>

<style scoped>
.verb { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.verb-btn {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  border-radius: var(--schools-radius-md);
  border: 1px solid var(--schools-border-strong);
  background: var(--schools-card);
  color: var(--schools-fg);
  cursor: pointer;
}
.verb-btn:hover { background: var(--schools-bg); }
.verb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.verb-btn.primary { background: var(--schools-red); border-color: var(--schools-red); color: var(--schools-card); }
.verb-btn.primary:hover { background: var(--schools-red-deep); }
.verb-btn.small { padding: 5px 10px; font-size: 12px; }
.confirm {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px dashed var(--schools-border-strong);
  border-radius: var(--schools-radius-md);
  background: var(--schools-card);
}
.what { font-size: 13px; color: var(--schools-fg-2); max-width: 48ch; }
.outcome { font-size: 12.5px; color: var(--intel-good); word-break: break-all; }
.outcome.failed { color: var(--intel-alarm); }
</style>
