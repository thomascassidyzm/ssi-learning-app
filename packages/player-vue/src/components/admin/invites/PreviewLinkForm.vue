<script setup lang="ts">
// Preview link (guest, no account) — ported from AdminTryLinks.vue's create
// form verbatim (label + ttl_days -> POST /api/try-link/create).
import { ref } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'

const emit = defineEmits<{ created: [] }>()

const { getAuthToken } = useAdminClient()

const isCreating = ref(false)
const error = ref<string | null>(null)
const mintedUrl = ref<string | null>(null)

const formLabel = ref('')
const formTtlDays = ref<number>(90)

async function createLink(): Promise<void> {
  if (!formLabel.value.trim()) {
    error.value = 'Label is required'
    return
  }

  isCreating.value = true
  error.value = null
  mintedUrl.value = null

  try {
    const token = await getAuthToken()
    if (!token) {
      error.value = 'Not authenticated'
      return
    }

    const response = await fetch('/api/try-link/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ label: formLabel.value.trim(), ttl_days: formTtlDays.value }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to create try link')
    }

    const created = await response.json()
    mintedUrl.value = `${window.location.origin}/try/${created.code}`
    emit('created')

    formLabel.value = ''
    formTtlDays.value = 90
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create try link'
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <form class="create-form" @submit.prevent="createLink">
    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <div class="field field-wide">
      <label class="schools-kicker">Label <span class="required">*</span></label>
      <input
        v-model="formLabel"
        type="text"
        class="frost-input"
        placeholder="e.g. Duolingo partnership, Aran's Twitter…"
      />
    </div>
    <div class="field">
      <label class="schools-kicker">Expires after <span class="optional">(days)</span></label>
      <input v-model.number="formTtlDays" type="number" min="1" max="365" class="frost-input" />
    </div>

    <div v-if="mintedUrl" class="field field-wide">
      <InviteLinkField :url="mintedUrl" label="Preview link created" copy-label="Copy link" />
    </div>

    <div class="field-actions">
      <button type="submit" class="btn-primary" :disabled="isCreating || !formLabel.trim()">
        <svg v-if="!isCreating" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span v-else class="spinner"></span>
        {{ isCreating ? 'Creating…' : 'Create link' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.create-form {
  padding: var(--space-5) var(--space-6) var(--space-6);
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--space-4);
}

.banner {
  grid-column: 1 / -1;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-wide { grid-column: 1 / -1; }

.field-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.field label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.required {
  color: rgb(var(--tone-red));
  font-weight: var(--font-bold);
  font-family: var(--font-mono);
}

.optional {
  color: var(--schools-fg-3);
  font-weight: var(--font-normal);
  text-transform: none;
  letter-spacing: 0;
}

.frost-input {
  font: inherit;
  font-size: var(--text-base);
  padding: 10px 14px;
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder { color: var(--schools-fg-3); }

.frost-input:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px 18px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: var(--schools-red);
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-base);
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.08), 0 4px 14px rgba(194, 58, 58, 0.22);
}

.btn-primary:hover:not(:disabled) {
  background: var(--schools-red-deep);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.10), 0 8px 22px rgba(194, 58, 58, 0.28);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .create-form { grid-template-columns: 1fr; }
}
</style>
