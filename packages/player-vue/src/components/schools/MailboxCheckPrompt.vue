<script setup lang="ts">
/**
 * The moment we ask a teacher whether their mailbox actually reaches them.
 *
 * Raised right after a keep-worthy act — see composables/useMailboxPrompt.ts
 * for the rule about when, and for why this is never a standing badge.
 *
 * Two things in here are load-bearing and easy to undo by accident:
 *   · THE ESCAPE. "Send it to a different address instead" is offered plainly
 *     and always, not hidden behind a "having trouble?" three taps down. A
 *     teacher's own address gets through when the school one will not, and
 *     that single option probably fixes most of the failures on its own.
 *   · WHERE THE OUTCOME RENDERS. Beside the button that was pressed, never at
 *     the foot of the card. SettingsScreen.vue paid for that lesson: on a
 *     phone, an error below the fold reads as the button doing nothing.
 */
import { computed, inject, ref } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { sendSignInCode } from '@/auth/sendSignInCode'
import { isAlreadyLinkedEmail } from '@/utils/emailVerifyGuard'
import { isMailboxUnproven } from '@/composables/useMailboxPrompt'
import { usePublishedMailboxCopy } from '@/composables/schools/usePublishedMailboxCopy'

const props = defineProps<{ isOpen: boolean; primaryEmail: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'proved'): void }>()

const { t } = useI18n()
const { copy } = usePublishedMailboxCopy()
/** Repo string first, Popty's redline on top of it if one has been published. */
const say = (key: string, floor: string) => copy(key, t(`schools.ui.mailboxCheck.${key}`, floor))

const auth = inject<any>('auth', null)
const supabase = inject<any>('supabase', null)

type Step = 'ask' | 'other' | 'code' | 'done'
const step = ref<Step>('ask')
const otherInput = ref('')
const codeInput = ref('')
const sentTo = ref('')
const sendError = ref('')
const codeError = ref('')
const isSending = ref(false)
const isChecking = ref(false)

const verifiedEmails = computed<string[]>(() => auth?.learner?.value?.verified_emails || [])
const unproven = computed(() => isMailboxUnproven(auth?.user?.value?.user_metadata))

async function send(address: string) {
  sendError.value = ''
  const email = address.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendError.value = say('invalidEmail', "That doesn't look like an email address.")
    return
  }
  // The account's OWN unproven primary is let through by the guard, because
  // that send IS the proof. Any other address already on the account is
  // already good news, so say so rather than mailing it pointlessly.
  if (isAlreadyLinkedEmail({
    email,
    primaryEmail: props.primaryEmail,
    verifiedEmails: verifiedEmails.value,
    isPrimaryUnverified: unproven.value,
  })) {
    sendError.value = say('alreadyLinked', "That one's already on your account, so you're covered.")
    return
  }
  if (!supabase?.value) {
    sendError.value = say('notConnected', 'Not connected — try again in a moment.')
    return
  }
  isSending.value = true
  try {
    const { error } = await sendSignInCode(supabase.value, email)
    if (error) {
      sendError.value = error.message || say('sendFailed', "Couldn't send the code. Try again in a moment.")
      return
    }
    sentTo.value = email
    codeInput.value = ''
    codeError.value = ''
    step.value = 'code'
  } catch {
    sendError.value = say('sendFailed', "Couldn't send the code. Try again in a moment.")
  } finally {
    isSending.value = false
  }
}

async function confirmCode() {
  codeError.value = ''
  const token = codeInput.value.trim()
  if (token.length < 6) {
    codeError.value = say('codeTooShort', 'The code is six digits.')
    return
  }
  if (!supabase?.value) {
    codeError.value = say('notConnected', 'Not connected — try again in a moment.')
    return
  }
  isChecking.value = true
  try {
    const session = await supabase.value.auth.getSession()
    const authToken = session.data?.session?.access_token
    const res = await fetch('/api/email/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ email: sentTo.value, token }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) {
      codeError.value = data.error || say('checkFailed', "That code didn't work. Check it and try again.")
      return
    }
    // Same local state the Settings path keeps — one storage shape, not two.
    if (auth?.learner?.value) {
      auth.learner.value = {
        ...auth.learner.value,
        verified_emails: [...new Set([...verifiedEmails.value, sentTo.value])],
      }
    }
    step.value = 'done'
    setTimeout(() => emit('proved'), 1600)
  } catch {
    codeError.value = say('checkFailed', "That code didn't work. Check it and try again.")
  } finally {
    isChecking.value = false
  }
}

function overlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="modal-overlay" @click="overlayClick">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mailbox-check-title">
          <div class="modal-decoration"></div>

          <div class="modal-body">
            <h2 id="mailbox-check-title" class="modal-title">
              {{ say('title', 'Can we reach you here?') }}
            </h2>

            <template v-if="step === 'done'">
              <p class="modal-lead">{{ say('success', 'Lovely — that mailbox reaches you. You are sorted for good.') }}</p>
            </template>

            <template v-else-if="step === 'code'">
              <p class="modal-lead">
                {{ say('codeSent', "Pop in the code we've just sent to {email} and you're sorted for good.").replace('{email}', sentTo) }}
              </p>
              <label class="field-label" for="mailbox-code">{{ say('codeLabel', 'Your code') }}</label>
              <input
                id="mailbox-code"
                v-model="codeInput"
                class="field-input"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
              />
              <div class="action-row">
                <button
                  data-walk="mailbox-check-confirm"
                  type="button"
                  class="btn-primary"
                  :disabled="isChecking"
                  @click="confirmCode"
                >
                  {{ isChecking ? say('confirming', 'Checking…') : say('confirmCta', "That's the one") }}
                </button>
                <span v-if="codeError" class="action-status error">{{ codeError }}</span>
              </div>
            </template>

            <template v-else>
              <p class="modal-lead">
                {{ say('lead', "Quick one — schools' spam filters are ferocious, and we'd rather find out now than the day you need to get back in.") }}
              </p>
              <p class="modal-reason">
                {{ say('reason', "It also means nothing about your learners ever goes to a mailbox that isn't yours.") }}
              </p>

              <template v-if="step === 'other'">
                <label class="field-label" for="mailbox-other">{{ say('otherLabel', 'Which address should we use?') }}</label>
                <input id="mailbox-other" v-model="otherInput" class="field-input" type="email" autocomplete="email" />
                <div class="action-row">
                  <button type="button" class="btn-primary" :disabled="isSending" @click="send(otherInput)">
                    {{ isSending ? say('sending', 'Sending…') : say('otherSendCta', 'Send it there') }}
                  </button>
                  <span v-if="sendError" class="action-status error">{{ sendError }}</span>
                </div>
              </template>

              <template v-else>
                <p class="modal-address">{{ primaryEmail }}</p>
                <div class="action-row">
                  <!-- HANDBOOK Prove your mailbox reaches you
                       section: getting-people-in
                       roles: school_admin, teacher
                       place: dashboard
                       parts: mailbox-check-confirm
                       keywords: email, mailbox, code, spam filter, locked out
                       What it's for. School mail gateways are ferocious, and a code that
                       never arrives is only discovered on the day you need it. This asks
                       once, at the moment you have just made something worth keeping, and
                       settles it.
                       Where it is. A card that appears right after you create a class or
                       copy a class join link, for as long as your address is unproven.
                       How you do it.
                       1. Tap **Send me a code**, or nominate a different address if your
                          school one eats our mail.
                       2. Type the six digits we send, and tap **That's the one**.
                       Worth knowing. Close it and it stays closed. It never comes back on
                       a timer.
                       checked: 520e3fa4.71943bea
                  -->
                  <button
                    data-walk="mailbox-check-send"
                    type="button"
                    class="btn-primary"
                    :disabled="isSending"
                    @click="send(primaryEmail)"
                  >
                    {{ isSending ? say('sending', 'Sending…') : say('sendCta', 'Send me a code') }}
                  </button>
                  <span v-if="sendError" class="action-status error">{{ sendError }}</span>
                </div>
                <button type="button" class="link-btn" @click="step = 'other'; sendError = ''; otherInput = ''">
                  {{ say('otherAddress', 'Send it to a different address instead') }}
                </button>
              </template>
            </template>
          </div>

          <footer v-if="step !== 'done'" class="modal-footer">
            <button type="button" class="btn-secondary" @click="emit('close')">
              {{ say('dismiss', 'Not now') }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, env(safe-area-inset-left, 0px)) max(24px, env(safe-area-inset-right, 0px));
  padding-top: max(24px, env(safe-area-inset-top, 0px));
  padding-bottom: max(24px, env(safe-area-inset-bottom, 0px));
  z-index: 1000;
}

.modal {
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: 20px;
  width: 100%;
  max-width: 460px;
  max-height: 90vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.1);
}

.modal-decoration {
  height: 20px;
  flex-shrink: 0;
  background: linear-gradient(90deg, var(--ssi-red, #c23a3a), var(--ssi-gold, #d4a853));
}

.modal-body {
  padding: 28px 24px 20px;
}

.modal-title {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0 0 12px 0;
}

.modal-lead {
  font-size: 0.9375rem;
  line-height: 1.55;
  color: var(--text-secondary, #b0b0b0);
  margin: 0 0 10px 0;
}

.modal-reason {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-muted, #707070);
  margin: 0 0 18px 0;
}

.modal-address {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.9375rem;
  color: var(--text-primary, #ffffff);
  background: var(--bg-secondary, #1a1a1a);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 0 0 16px 0;
  overflow-wrap: anywhere;
}

.field-label {
  display: block;
  font-size: 0.8125rem;
  color: var(--text-muted, #707070);
  margin-bottom: 6px;
}

.field-input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-medium, rgba(255, 255, 255, 0.15));
  background: var(--bg-secondary, #1a1a1a);
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 1rem;
  margin-bottom: 14px;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.action-status {
  font-size: 0.8125rem;
  line-height: 1.4;
  flex: 1 1 160px;
}

.action-status.error {
  color: var(--error, #e57373);
}

.link-btn {
  display: block;
  margin-top: 16px;
  padding: 0;
  background: none;
  border: none;
  color: var(--ssi-gold, #d4a853);
  font-family: inherit;
  font-size: 0.875rem;
  text-decoration: underline;
  cursor: pointer;
}

.modal-footer {
  display: flex;
  padding: 0 24px 22px;
}

.btn-primary,
.btn-secondary {
  padding: 13px 22px;
  border-radius: 12px;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  min-height: 48px;
}

.btn-primary {
  background: var(--ssi-red, #c23a3a);
  border: none;
  color: white;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn-secondary {
  flex: 1;
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-medium, rgba(255, 255, 255, 0.15));
  color: var(--text-primary, #ffffff);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
