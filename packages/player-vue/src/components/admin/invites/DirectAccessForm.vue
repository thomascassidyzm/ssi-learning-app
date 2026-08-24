<script setup lang="ts">
// Direct access (no organisation) — three delivery sub-variants sharing one
// segmented control: individual (a named person, redeemable code), email
// allowlist (delivery by email-match), preview link (guest, no account).
// Deep-linkable via ?sub= — 'code' stays the sub key so existing links live.
import { ref, watch } from 'vue'
import IndividualAccessForm from './IndividualAccessForm.vue'
import EmailAllowlistForm from './EmailAllowlistForm.vue'
import PreviewLinkForm from './PreviewLinkForm.vue'

type SubMode = 'code' | 'email' | 'preview'

const props = defineProps<{ initialSub?: string }>()
const emit = defineEmits<{ created: [] }>()

function normalizeSub(v: string | undefined): SubMode {
  return v === 'email' || v === 'preview' ? v : 'code'
}

const sub = ref<SubMode>(normalizeSub(props.initialSub))

watch(() => props.initialSub, (v) => { sub.value = normalizeSub(v) })
</script>

<template>
  <div class="direct-access-form">
    <div class="sub-toggle" role="tablist">
      <button
        type="button" role="tab" class="sub-btn"
        :class="{ 'is-active': sub === 'code' }"
        :aria-selected="sub === 'code'"
        @click="sub = 'code'"
      >Individual</button>
      <button
        type="button" role="tab" class="sub-btn"
        :class="{ 'is-active': sub === 'email' }"
        :aria-selected="sub === 'email'"
        @click="sub = 'email'"
      >Email allowlist</button>
      <button
        type="button" role="tab" class="sub-btn"
        :class="{ 'is-active': sub === 'preview' }"
        :aria-selected="sub === 'preview'"
        @click="sub = 'preview'"
      >Preview link</button>
    </div>

    <IndividualAccessForm v-if="sub === 'code'" @created="emit('created')" />
    <EmailAllowlistForm v-else-if="sub === 'email'" @created="emit('created')" />
    <PreviewLinkForm v-else @created="emit('created')" />
  </div>
</template>

<style scoped>
.direct-access-form {
  display: flex;
  flex-direction: column;
}

.sub-toggle {
  display: flex;
  gap: 2px;
  padding: var(--space-3) var(--space-6) 0;
}

.sub-btn {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 6px 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  color: var(--schools-fg-3);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sub-btn:hover { color: var(--schools-fg); background: rgba(44, 38, 34, 0.04); }

.sub-btn.is-active {
  background: rgba(44, 38, 34, 0.06);
  color: var(--schools-fg);
}
</style>
