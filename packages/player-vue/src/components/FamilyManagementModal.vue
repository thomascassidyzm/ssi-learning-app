<script setup lang="ts">
/**
 * FamilyManagementModal — the Settings → Family page (FAMILY-PLAN-SPEC.md §4).
 * Owner-only: list members, invite by email (magic-grade — Grandpa never sees
 * the word "family"), add a child (synthetic account + QR sign-in link,
 * age-verification sidestep preserved), remove. No barbaric flows: every
 * action here is one tap, no password/email/birthday from a child ever.
 */
import { ref, computed, watch } from 'vue'
import { useFamilyManagement } from '@/composables/useFamilyManagement'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { state, isLoading, error, load, inviteByEmail, addChild, getSignInLink, removeMember } =
  useFamilyManagement()

watch(
  () => props.isOpen,
  (open) => { if (open) load() },
)

const seatsFull = computed(() => state.value.seatsUsed >= state.value.seatCap)

// ── Add-by-email ────────────────────────────────────────────────────────────
const showEmailForm = ref(false)
const emailInput = ref('')
const emailBusy = ref(false)
async function submitEmail() {
  if (!emailInput.value.trim() || emailBusy.value) return
  emailBusy.value = true
  const res = await inviteByEmail(emailInput.value.trim())
  emailBusy.value = false
  if (res.ok) { emailInput.value = ''; showEmailForm.value = false }
}

// ── Add-a-child + QR ─────────────────────────────────────────────────────────
const showChildForm = ref(false)
const childNameInput = ref('')
const childBusy = ref(false)
const qrDataUrl = ref<string | null>(null)
const activeSignInLink = ref<string | null>(null)
const activeSignInLinkLabel = ref<string>('')

async function renderQr(link: string) {
  try {
    const QRCode = await import('qrcode')
    qrDataUrl.value = await QRCode.toDataURL(link, { width: 240, margin: 1 })
  } catch {
    qrDataUrl.value = null // link + "copy" still works without the image
  }
}

async function submitChild() {
  if (!childNameInput.value.trim() || childBusy.value) return
  childBusy.value = true
  const res = await addChild(childNameInput.value.trim())
  childBusy.value = false
  if (res.ok) {
    childNameInput.value = ''
    showChildForm.value = false
    if (res.signInLink) {
      activeSignInLink.value = res.signInLink
      activeSignInLinkLabel.value = 'Scan to sign in'
      await renderQr(res.signInLink)
    }
  }
}

async function reMintLink(memberId: string, name: string) {
  const res = await getSignInLink(memberId)
  if (res.ok && res.signInLink) {
    activeSignInLink.value = res.signInLink
    activeSignInLinkLabel.value = `New sign-in link for ${name}`
    await renderQr(res.signInLink)
  }
}

function closeLinkPanel() {
  activeSignInLink.value = null
  qrDataUrl.value = null
}

async function copyLink() {
  if (!activeSignInLink.value) return
  try { await navigator.clipboard.writeText(activeSignInLink.value) } catch { /* clipboard may be unavailable */ }
}

async function handleRemove(memberId: string) {
  await removeMember(memberId)
}

function statusLabel(m: { status: string; is_child_account: boolean }): string {
  if (m.status === 'invited') return 'Invited'
  if (m.is_child_account) return 'Active'
  return 'Active'
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="family-overlay" role="dialog" aria-modal="true" aria-label="Family" @click.self="emit('close')">
      <div class="family-card" @click.stop>
        <header class="family-bar">
          <span class="family-title">Family</span>
          <button type="button" class="family-close" aria-label="Close" @click="emit('close')">✕</button>
        </header>

        <div class="family-scroll">
          <p class="family-seats">{{ state.seatsUsed }} of {{ state.seatCap }} seats used (including you)</p>
          <p v-if="error" class="family-error">{{ error }}</p>

          <!-- Sign-in link / QR panel — shown right after add-child, or on re-mint -->
          <div v-if="activeSignInLink" class="link-panel">
            <p class="link-panel-label">{{ activeSignInLinkLabel }}</p>
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="Sign-in QR code" class="qr-img" />
            <div class="link-row">
              <input :value="activeSignInLink" readonly class="link-input" @focus="($event.target as HTMLInputElement).select()" />
              <button type="button" class="text-btn" @click="copyLink">Copy</button>
            </div>
            <button type="button" class="text-btn text-btn--secondary" @click="closeLinkPanel">Done</button>
          </div>

          <!-- Members list -->
          <ul v-if="state.members.length" class="member-list">
            <li v-for="m in state.members" :key="m.id" class="member-row">
              <div class="member-info">
                <span class="member-name">{{ m.display_name || m.invited_email || 'Member' }}</span>
                <span class="member-status">{{ statusLabel(m) }}<template v-if="m.is_child_account"> · Child account</template></span>
              </div>
              <div class="member-actions">
                <button
                  v-if="m.is_child_account"
                  type="button"
                  class="text-btn"
                  @click="reMintLink(m.id, m.display_name || 'this child')"
                >Get sign-in link</button>
                <button type="button" class="text-btn text-btn--danger" @click="handleRemove(m.id)">Remove</button>
              </div>
            </li>
          </ul>
          <p v-else-if="!isLoading" class="family-empty">No one added yet.</p>

          <!-- Add actions -->
          <div v-if="seatsFull" class="family-full">Family is full ({{ state.seatCap }} seats including you).</div>
          <template v-else>
            <div class="add-section">
              <button v-if="!showChildForm" type="button" class="add-btn" @click="showChildForm = true">+ Add a child</button>
              <form v-else class="add-form" @submit.prevent="submitChild">
                <input v-model="childNameInput" type="text" placeholder="First name" maxlength="40" class="add-input" />
                <button type="submit" class="text-btn" :disabled="!childNameInput.trim() || childBusy">{{ childBusy ? '...' : 'Add' }}</button>
                <button type="button" class="text-btn text-btn--secondary" @click="showChildForm = false">Cancel</button>
              </form>
            </div>
            <div class="add-section">
              <button v-if="!showEmailForm" type="button" class="add-btn" @click="showEmailForm = true">+ Invite by email</button>
              <form v-else class="add-form" @submit.prevent="submitEmail">
                <input v-model="emailInput" type="email" placeholder="email@example.com" class="add-input" />
                <button type="submit" class="text-btn" :disabled="!emailInput.trim() || emailBusy">{{ emailBusy ? '...' : 'Invite' }}</button>
                <button type="button" class="text-btn text-btn--secondary" @click="showEmailForm = false">Cancel</button>
              </form>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.family-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
  padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
    max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
  box-sizing: border-box;
}
.family-card {
  width: 100%;
  max-width: 460px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated, #ffffff);
  border-radius: 1rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.family-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle, #e2e8f0);
}
.family-title { font-weight: 700; font-size: 0.95rem; letter-spacing: 0.02em; color: var(--text-primary, #1e293b); }
.family-close {
  width: 2.25rem; height: 2.25rem; border: none; border-radius: 0.6rem;
  background: var(--bg-subtle, #f1f5f9); color: var(--text-primary, #1e293b);
  font-size: 1.05rem; cursor: pointer;
}
.family-scroll { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 1rem; }
.family-seats { margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--text-secondary, #64748b); }
.family-error { color: #dc2626; font-size: 0.85rem; margin-bottom: 0.75rem; }
.family-empty { color: var(--text-secondary, #64748b); font-size: 0.9rem; }
.family-full {
  padding: 0.75rem; border-radius: 0.6rem; background: var(--bg-subtle, #f1f5f9);
  color: var(--text-secondary, #64748b); font-size: 0.85rem; text-align: center;
}

.member-list { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.member-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 0.75rem; border-radius: 0.6rem; background: var(--bg-subtle, #f8fafc);
}
.member-info { display: flex; flex-direction: column; gap: 0.15rem; }
.member-name { font-weight: 600; font-size: 0.9rem; color: var(--text-primary, #1e293b); }
.member-status { font-size: 0.78rem; color: var(--text-secondary, #64748b); }
.member-actions { display: flex; gap: 0.5rem; }

.add-section { margin-bottom: 0.6rem; }
.add-btn {
  width: 100%; padding: 0.65rem; border: 1px dashed var(--border-subtle, #cbd5e1);
  border-radius: 0.6rem; background: transparent; color: var(--text-primary, #1e293b);
  font-size: 0.88rem; cursor: pointer;
}
.add-form { display: flex; gap: 0.4rem; align-items: center; }
.add-input {
  flex: 1; padding: 0.55rem 0.7rem; border-radius: 0.5rem; border: 1px solid var(--border-subtle, #cbd5e1);
  font-size: 0.88rem;
}

.text-btn { background: none; border: none; color: var(--accent, #2563eb); font-size: 0.85rem; font-weight: 600; cursor: pointer; padding: 0.3rem 0.4rem; }
.text-btn--secondary { color: var(--text-secondary, #64748b); }
.text-btn--danger { color: #dc2626; }
.text-btn:disabled { opacity: 0.5; cursor: default; }

.link-panel {
  display: flex; flex-direction: column; align-items: center; gap: 0.5rem;
  padding: 1rem; margin-bottom: 1rem; border-radius: 0.75rem; background: var(--bg-subtle, #f8fafc);
  border: 1px solid var(--border-subtle, #e2e8f0);
}
.link-panel-label { font-size: 0.85rem; font-weight: 600; color: var(--text-primary, #1e293b); margin: 0; }
.qr-img { width: 180px; height: 180px; border-radius: 0.5rem; }
.link-row { display: flex; gap: 0.4rem; width: 100%; }
.link-input {
  flex: 1; padding: 0.5rem; border-radius: 0.5rem; border: 1px solid var(--border-subtle, #cbd5e1);
  font-size: 0.75rem; color: var(--text-secondary, #64748b);
}
</style>
