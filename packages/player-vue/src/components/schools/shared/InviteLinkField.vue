<script setup lang="ts">
// Every surface that offers an invite shows the FULL URL as visible,
// selectable text (monospace + copy button) — not just a bare Copy button.
// One shared component instead of five near-duplicate markup blocks.
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  url: string
  label?: string
  copyLabel?: string
}>(), {
  label: '',
  copyLabel: 'Copy invite link',
})

const copied = ref(false)
async function copy() {
  if (!props.url) return
  try {
    await navigator.clipboard.writeText(props.url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <div class="invite-link-field">
    <div v-if="label" class="invite-link-label">{{ label }}</div>
    <div class="invite-link-row">
      <code class="invite-link-url">{{ url || 'Link will appear here once ready.' }}</code>
      <button
        type="button"
        class="btn-ghost btn-small invite-link-copy"
        :class="{ copied }"
        :disabled="!url"
        @click="copy"
      >
        {{ copied ? 'Copied' : copyLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.invite-link-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.invite-link-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--schools-fg-2);
}

.invite-link-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--schools-bg);
  border: 1px solid var(--schools-border);
  border-radius: 6px;
}

.invite-link-url {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--schools-fg);
  letter-spacing: 0.02em;
  word-break: break-all;
}

.invite-link-copy {
  flex: none;
}

.invite-link-copy.copied {
  background: var(--schools-success);
  border-color: var(--schools-success);
  color: #fff;
}
</style>
