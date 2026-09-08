<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
const { t } = useI18n()
/**
 * FamilyManagementModal — the Settings → Family page (FAMILY-PLAN-SPEC.md §4).
 * Owner-only: list members, invite by email (magic-grade — Grandpa never sees
 * the word "family"), add a child (synthetic account + QR sign-in link,
 * age-verification sidestep preserved), remove. No barbaric flows: every
 * action here is one tap, no password/email/birthday from a child ever.
 *
 * EVERY STATE ON THIS SCREEN TELLS THE TRUTH (Tom, 2026-09-07, after walking
 * it with his own card). He invited an adult and the row said "Invited" and
 * nothing else, while the mail had been delivered within a second; he added a
 * child and got "Failed to create child account" with no cause and no way on.
 * So each row now says what has happened, what happens next, and what to do
 * if it is stuck: an invite says when we emailed them and offers a resend; a
 * child row says how a child signs in; the owner is listed as one of the
 * places; every failure says what did not happen and whether it is safe to
 * try again. The words live in locales/eng.json under `family.*`.
 */
import { ref, computed, watch } from 'vue'
import { useFamilyManagement, type FamilyMember } from '@/composables/useFamilyManagement'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { state, isLoading, error, load, inviteByEmail, addChild, getSignInLink, removeMember } =
  useFamilyManagement()

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      notice.value = ''
      confirmRemoveId.value = null
      load()
    }
  },
)

const seatsFull = computed(() => state.value.seatsUsed >= state.value.seatCap)
const seatsLine = computed(() =>
  t('family.placesUsed').replace('{used}', String(state.value.seatsUsed)).replace('{cap}', String(state.value.seatCap)),
)
const fullLine = computed(() => t('family.familyFull').replace('{cap}', String(state.value.seatCap)))
// TWO DATES, BOTH FROM THE SERVER (Tom's 30-day grace, 2026-09-08): the day
// the plan becomes Premium, and the day — 30 days later — everybody here
// actually stops being covered. Neither is worked out in this file.
const familyEndsLine = computed(() => {
  const changesAt = state.value.planChangesAt
  const coverEndsAt = state.value.familyEndsAt
  if (!coverEndsAt) return ''
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
  // A cancellation is the other way this ends, and it ends everything at the
  // paid period — nobody is paying afterwards, so there is no grace to name.
  if (!changesAt) return t('family.planCancelsOn').replace('{date}', day(coverEndsAt))
  return t('family.planEndsOn').replace('{date}', day(changesAt)).replace('{coverDate}', day(coverEndsAt))
})

// One line of good news under the seats count — "invite sent to X", "we sent
// it again", "they already had an account". Cleared by the next action.
const notice = ref('')

function fill(key: string, vars: Record<string, string>): string {
  let out = t(key)
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, v)
  return out
}

function memberName(m: FamilyMember): string {
  return m.display_name || m.invited_email || t('family.family')
}

/** What has happened to this row, in one line. */
function statusLine(m: FamilyMember): string {
  if (m.status === 'invited') {
    if (!m.invite_emailed_at) return t('family.invitedNotEmailed')
    const when = new Date(m.invite_emailed_at)
    const today = new Date()
    const sameDay = when.toDateString() === today.toDateString()
    return sameDay
      ? fill('family.invitedEmailedAt', { time: when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })
      : fill('family.invitedEmailedOn', { date: when.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) })
  }
  if (m.is_child_account) return t('family.childAccount')
  return t('family.joined')
}

// ── Add-by-email ────────────────────────────────────────────────────────────
const showEmailForm = ref(false)
const emailInput = ref('')
const emailBusy = ref(false)
async function submitEmail() {
  if (!emailInput.value.trim() || emailBusy.value) return
  emailBusy.value = true
  notice.value = ''
  const email = emailInput.value.trim()
  const res = await inviteByEmail(email)
  emailBusy.value = false
  if (res.ok) {
    emailInput.value = ''
    showEmailForm.value = false
    notice.value = res.attachedNow
      ? fill('family.inviteAttached', { email })
      : !res.emailed
        ? fill('family.inviteNotEmailed', { email })
        : res.resent
          ? fill('family.inviteResent', { email })
          : fill('family.inviteSent', { email })
  }
}

// Re-sending is the same call: the server recognises the live invite and
// mails it again rather than refusing it as a duplicate.
const resendingId = ref<string | null>(null)
async function resendInvite(m: FamilyMember) {
  if (!m.invited_email || resendingId.value) return
  resendingId.value = m.id
  notice.value = ''
  const res = await inviteByEmail(m.invited_email)
  resendingId.value = null
  if (res.ok) {
    notice.value = res.emailed
      ? fill('family.inviteResent', { email: m.invited_email })
      : fill('family.inviteNotEmailed', { email: m.invited_email })
  }
}

// ── Add-a-child + QR ─────────────────────────────────────────────────────────
const showChildForm = ref(false)
const childNameInput = ref('')
const childBusy = ref(false)
const qrDataUrl = ref<string | null>(null)
const activeSignInLink = ref<string | null>(null)
const activeSignInLinkLabel = ref<string>('')
const activeSignInLinkHow = ref<string>('')

async function renderQr(link: string) {
  try {
    const QRCode = await import('qrcode')
    qrDataUrl.value = await QRCode.toDataURL(link, { width: 240, margin: 1 })
  } catch {
    qrDataUrl.value = null // link + "copy" still works without the image
  }
}

async function showLink(link: string, label: string, name: string) {
  activeSignInLink.value = link
  activeSignInLinkLabel.value = label
  activeSignInLinkHow.value = fill('family.signInLinkHow', { name })
  copied.value = false
  await renderQr(link)
}

async function submitChild() {
  if (!childNameInput.value.trim() || childBusy.value) return
  childBusy.value = true
  notice.value = ''
  const name = childNameInput.value.trim()
  const res = await addChild(name)
  childBusy.value = false
  if (res.ok) {
    childNameInput.value = ''
    showChildForm.value = false
    if (res.signInLink) await showLink(res.signInLink, fill('family.signInLinkFor', { name }), name)
  }
}

async function reMintLink(memberId: string, name: string) {
  notice.value = ''
  const res = await getSignInLink(memberId)
  if (res.ok && res.signInLink) await showLink(res.signInLink, fill('family.newSignInLinkFor', { name }), name)
}

function closeLinkPanel() {
  activeSignInLink.value = null
  qrDataUrl.value = null
}

const copied = ref(false)
async function copyLink() {
  if (!activeSignInLink.value) return
  try {
    await navigator.clipboard.writeText(activeSignInLink.value)
    copied.value = true
  } catch { /* clipboard may be unavailable */ }
}

// ── Remove, with one honest confirmation ────────────────────────────────────
// Removing somebody ends their access at once, so the row asks first — inline,
// in its own words, never a browser dialog.
const confirmRemoveId = ref<string | null>(null)
const removingId = ref<string | null>(null)
async function confirmRemove(m: FamilyMember) {
  if (removingId.value) return
  removingId.value = m.id
  notice.value = ''
  await removeMember(m.id)
  removingId.value = null
  confirmRemoveId.value = null
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="family-overlay" role="dialog" aria-modal="true" :aria-label="t('family.family')" @click.self="emit('close')">
      <div class="family-card" @click.stop>
        <header class="family-bar">
          <span class="family-title">{{ t('family.family') }}</span>
          <button type="button" class="family-close" :aria-label="t('sector.close')" @click="emit('close')">✕</button>
        </header>

        <div class="family-scroll">
          <p class="family-seats">{{ seatsLine }}</p>
          <p v-if="!isLoading && !state.hasFamilyPlan" class="family-warn">{{ t('family.planNotActive') }}</p>
          <!-- A change the owner has scheduled (job #376·F, D5): the places
               stay covered until the date, and nobody is removed. -->
          <p v-else-if="!isLoading && familyEndsLine" class="family-warn">{{ familyEndsLine }}</p>
          <p v-if="error" class="family-error" role="alert">{{ error }}</p>
          <p v-else-if="notice" class="family-notice" role="status">{{ notice }}</p>

          <!-- Sign-in link / QR panel — shown right after add-child, or on re-mint -->
          <div v-if="activeSignInLink" class="link-panel">
            <p class="link-panel-label">{{ activeSignInLinkLabel }}</p>
            <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('family.signQrCode')" class="qr-img" />
            <p class="link-panel-how">{{ activeSignInLinkHow }}</p>
            <div class="link-row">
              <input :value="activeSignInLink" readonly class="link-input" @focus="($event.target as HTMLInputElement).select()" />
              <button type="button" class="text-btn" @click="copyLink">{{ copied ? t('family.copied') : t('family.copy') }}</button>
            </div>
            <button type="button" class="text-btn text-btn--secondary" @click="closeLinkPanel">{{ t('family.done') }}</button>
          </div>

          <!-- Members list: the owner first, as one of the places -->
          <ul class="member-list">
            <li class="member-row">
              <div class="member-info">
                <span class="member-name">{{ t('family.you') }}</span>
                <span class="member-status">{{ t('family.planOwner') }}</span>
              </div>
            </li>
            <li v-for="m in state.members" :key="m.id" class="member-row" :class="{ 'member-row--confirm': confirmRemoveId === m.id }">
              <template v-if="confirmRemoveId === m.id">
                <div class="member-info">
                  <span class="member-name">{{ fill(m.is_child_account ? 'family.removeChildConfirm' : 'family.removeConfirm', { name: memberName(m) }) }}</span>
                </div>
                <div class="member-actions">
                  <button type="button" class="text-btn text-btn--danger" :disabled="removingId === m.id" @click="confirmRemove(m)">
                    {{ removingId === m.id ? t('family.removing') : t('family.remove') }}
                  </button>
                  <button type="button" class="text-btn text-btn--secondary" :disabled="removingId === m.id" @click="confirmRemoveId = null">{{ t('family.keep') }}</button>
                </div>
              </template>
              <template v-else>
                <div class="member-info">
                  <span class="member-name">{{ memberName(m) }}</span>
                  <span class="member-status">{{ statusLine(m) }}</span>
                  <span v-if="m.status === 'invited'" class="member-next">{{ t('family.invitedNext') }}</span>
                </div>
                <div class="member-actions">
                  <button
                    v-if="m.status === 'invited'"
                    type="button"
                    class="text-btn"
                    :disabled="resendingId === m.id"
                    @click="resendInvite(m)"
                  >{{ resendingId === m.id ? t('family.sending') : t('family.resend') }}</button>
                  <button
                    v-if="m.is_child_account"
                    type="button"
                    class="text-btn"
                    @click="reMintLink(m.id, memberName(m))"
                  >{{ t('family.getSignLink') }}</button>
                  <button type="button" class="text-btn text-btn--danger" @click="confirmRemoveId = m.id">{{ t('family.remove') }}</button>
                </div>
              </template>
            </li>
          </ul>

          <!-- Removed children keep their door. A child account has no email and
               no way to pay, so the parent-minted link is its only way in and it
               stays available here forever (job #376·F, D7). -->
          <template v-if="state.removedChildren.length">
            <p class="removed-title">{{ t('family.removedChildrenTitle') }}</p>
            <ul class="member-list">
              <li v-for="m in state.removedChildren" :key="m.id" class="member-row">
                <div class="member-info">
                  <span class="member-name">{{ memberName(m) }}</span>
                  <span class="member-status">{{ t('family.removedChildAccount') }}</span>
                </div>
                <div class="member-actions">
                  <button type="button" class="text-btn" @click="reMintLink(m.id, memberName(m))">{{ t('family.getSignLink') }}</button>
                </div>
              </li>
            </ul>
          </template>

          <p v-if="isLoading && !state.members.length" class="family-empty">{{ t('family.loading') }}</p>
          <p v-else-if="!state.members.length && !state.removedChildren.length" class="family-empty">{{ t('family.noOneAddedYetHow') }}</p>

          <!-- Add actions -->
          <div v-if="seatsFull" class="family-full">{{ fullLine }}</div>
          <template v-else>
            <div class="add-section">
              <button v-if="!showChildForm" type="button" class="add-btn" @click="showChildForm = true">{{ t('family.addChild') }}</button>
              <form v-else class="add-form" @submit.prevent="submitChild">
                <input v-model="childNameInput" type="text" :placeholder="t('family.childFirstName')" maxlength="40" class="add-input" />
                <button type="submit" class="text-btn" :disabled="!childNameInput.trim() || childBusy">{{ childBusy ? t('family.sending') : t('family.add') }}</button>
                <button type="button" class="text-btn text-btn--secondary" @click="showChildForm = false">{{ t('settings.cancel') }}</button>
              </form>
            </div>
            <div class="add-section">
              <button v-if="!showEmailForm" type="button" class="add-btn" @click="showEmailForm = true">{{ t('family.inviteByEmail') }}</button>
              <form v-else class="add-form" @submit.prevent="submitEmail">
                <input v-model="emailInput" type="email" placeholder="email@example.com" class="add-input" />
                <button type="submit" class="text-btn" :disabled="!emailInput.trim() || emailBusy">{{ emailBusy ? t('family.sending') : t('family.invite') }}</button>
                <button type="button" class="text-btn text-btn--secondary" @click="showEmailForm = false">{{ t('settings.cancel') }}</button>
              </form>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.removed-title {
  margin: 1rem 0 0.25rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
}

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
.family-notice { color: var(--text-primary, #1e293b); font-size: 0.85rem; margin: 0 0 0.75rem; padding: 0.5rem 0.7rem; background: var(--bg-secondary, #f1f5f9); border-radius: 0.5rem; }
.family-warn { color: #b45309; font-size: 0.85rem; margin: 0 0 0.75rem; }
.member-next { font-size: 0.76rem; color: var(--text-secondary, #64748b); line-height: 1.35; margin-top: 0.15rem; }
.member-row--confirm { background: #fef2f2; }
.link-panel-how { font-size: 0.8rem; color: var(--text-secondary, #64748b); line-height: 1.4; margin: 0; }
.family-empty { color: var(--text-secondary, #64748b); font-size: 0.9rem; }
.family-full {
  padding: 0.75rem; border-radius: 0.6rem; background: var(--bg-subtle, #f1f5f9);
  color: var(--text-secondary, #64748b); font-size: 0.85rem; text-align: center;
}

.member-list { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.member-row {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.5rem;
  padding: 0.6rem 0.75rem; border-radius: 0.6rem; background: var(--bg-subtle, #f8fafc);
}
.member-info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1 1 12rem; }
.member-name { font-weight: 600; font-size: 0.9rem; color: var(--text-primary, #1e293b); }
.member-status { font-size: 0.78rem; color: var(--text-secondary, #64748b); }
.member-actions { display: flex; gap: 0.5rem; margin-left: auto; flex: 0 0 auto; }
.member-actions .text-btn { white-space: nowrap; }

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
