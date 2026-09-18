<script setup lang="ts">
/**
 * MailboxBanner — "confirm your email when it arrives", for a school leader
 * who came in through the door with no code (job #188, Tom 2026-09-18).
 *
 * The door mints the session and provisions the school before any mail is
 * read (api/auth/setup-mint.ts). This is the other half: the six digits still
 * go out, and this strip at the top of the dashboard takes them whenever they
 * land — today, tomorrow, after the gateway lets go of them. It never blocks
 * anything. A wrong or stale code is a soft line beside the field; a fresh
 * code and a different address are one tap each.
 *
 * WHO SEES IT. Only the account whose own mailbox is unproven AND that came
 * through the setup door (user_metadata.setup_door). Invited teachers keep
 * the moment-based MailboxCheckPrompt — that design asks once, at a
 * keep-worthy moment, and this strip is deliberately not that: a founding
 * admin has a whole school resting on an address nobody has proved yet, so
 * for them a standing, closable reminder is the honest shape.
 *
 * WHAT PROVING DOES. api/email/verify.ts sets email_confirmed_manually,
 * clears learners.needs_verification and — since #188 — writes the school's
 * domain claim, which provision.ts deferred for an unproven admin. The
 * account's local user_metadata is patched the same way useAuth does after
 * a password set, so the strip disappears without a reload.
 */
import { computed, inject, ref } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { sendSignInCode } from '@/auth/sendSignInCode'
import { shouldShowMailboxBanner } from '@/composables/useMailboxPrompt'
import { friendlyVerifyCodeError, resendCountdownLabel } from '@/auth/codeSupersession'
import { useResendCooldown } from '@/composables/useResendCooldown'

const { t } = useI18n()
const auth = inject<any>('auth', null)
const supabase = inject<any>('supabase', null)

const metadata = computed<Record<string, unknown> | null>(() => auth?.user?.value?.user_metadata ?? null)
const primaryEmail = computed<string>(() => auth?.user?.value?.email || '')

/** Closed for this browsing session only: the proof is still owed, so the
 *  strip comes back next visit. Nothing durable — a durable dismissal would
 *  hide the only way of proving the address from inside the dashboard. */
const collapsed = ref(false)

const isOpen = computed(() => shouldShowMailboxBanner({ metadata: metadata.value, collapsed: collapsed.value }))

const sentTo = ref('')
const codeInput = ref('')
const otherInput = ref('')
const showOther = ref(false)
const status = ref('')
const statusKind = ref<'info' | 'error' | 'done'>('info')
const busy = ref(false)
const resendCooldown = useResendCooldown()
const resendCount = ref(0)

function say(kind: 'info' | 'error' | 'done', text: string) {
  statusKind.value = kind
  status.value = text
}

async function resend(address?: string) {
  const email = (address ?? primaryEmail.value).trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    say('error', t('schools.ui.mailboxBanner.invalidEmail', "That doesn't look like an email address."))
    return
  }
  if (!supabase?.value) {
    say('error', t('schools.ui.mailboxBanner.notConnected', 'Not connected — try again in a moment.'))
    return
  }
  if (!resendCooldown.canResend.value) return
  busy.value = true
  try {
    const { error } = await sendSignInCode(supabase.value, email)
    if (error) {
      say('error', error.message)
      return
    }
    resendCount.value += 1
    resendCooldown.start()
    sentTo.value = email
    showOther.value = false
    codeInput.value = ''
    say('info', t('schools.ui.mailboxBanner.sent', 'Sent. Only the newest code works, and asking again cancels it — give a school mail system a few minutes.'))
  } finally {
    busy.value = false
  }
}

async function confirm() {
  const token = codeInput.value.replace(/\D/g, '')
  if (token.length < 6) {
    say('error', t('schools.ui.mailboxBanner.codeTooShort', 'The code is six digits.'))
    return
  }
  if (!supabase?.value) {
    say('error', t('schools.ui.mailboxBanner.notConnected', 'Not connected — try again in a moment.'))
    return
  }
  busy.value = true
  try {
    const session = await supabase.value.auth.getSession()
    const authToken = session.data?.session?.access_token
    const email = sentTo.value || primaryEmail.value
    const res = await fetch('/api/email/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify({ email, token }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) {
      // Soft, never a wall: the usual truth on a school mail estate is a
      // superseded code, and it is named as such (auth/codeSupersession.ts).
      say('error', friendlyVerifyCodeError(data?.error, { resends: resendCount.value }))
      return
    }
    say('done', t('schools.ui.mailboxBanner.done', 'Lovely — that mailbox reaches you. You are sorted for good.'))
    // Same local patch useAuth applies after a password set: the predicate
    // flips here, so the strip goes without a reload.
    if (auth?.user?.value && email === primaryEmail.value.toLowerCase()) {
      auth.user.value = {
        ...auth.user.value,
        user_metadata: { ...(auth.user.value.user_metadata || {}), email_confirmed_manually: true },
      }
    }
    if (auth?.learner?.value) {
      auth.learner.value = {
        ...auth.learner.value,
        needs_verification: false,
        verified_emails: [...new Set([...(auth.learner.value.verified_emails || []), email])],
      }
    }
  } catch {
    say('error', friendlyVerifyCodeError('network error'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="isOpen" class="mailbox-banner" role="status">
    <div class="mailbox-banner__row">
      <p class="mailbox-banner__lead">
        {{ t('schools.ui.mailboxBanner.lead', "Your school is live. When our code reaches {email}, pop it in here to confirm it's yours.").replace('{email}', sentTo || primaryEmail) }}
      </p>
      <form class="mailbox-banner__form" @submit.prevent="confirm">
        <input
          v-model="codeInput"
          class="mailbox-banner__input"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          :placeholder="t('schools.ui.mailboxBanner.codePlaceholder', '6-digit code')"
          :aria-label="t('schools.ui.mailboxBanner.codeLabel', 'Your code')"
        />
        <!-- HANDBOOK Confirm your email from the dashboard
             section: your-own-account
             moment: setting-up
             roles: school_admin
             place: dashboard
             keywords: email, code, confirm, verify, spam filter, hwb, banner
             What it's for. Proving the address your school was set up with actually
             reaches you, without it ever standing between you and your dashboard.
             Where it is. The strip across the top of every schools page, for as long as
             your address is unconfirmed.
             How you do it.
             1. Wait for our six-digit code. School mail systems can hold it for a while.
             2. Type it into the strip and tap **Confirm**.
             Worth knowing. A code that has gone stale just says so; tap **Send a fresh
             code** and use the newest one. If your school address eats our mail, tap
             **Use a different address** and confirm from a personal one instead. Nothing
             in your school waits on this.
             checked: d98495b9.4571a1cb
        -->
        <button data-walk="mailbox-banner-confirm" type="submit" class="mailbox-banner__btn" :disabled="busy">
          {{ t('schools.ui.mailboxBanner.confirm', 'Confirm') }}
        </button>
      </form>
      <div class="mailbox-banner__links">
        <button type="button" class="mailbox-banner__link" :disabled="busy || !resendCooldown.canResend.value" @click="resend()">
          {{ resendCountdownLabel(resendCooldown.secondsLeft.value) }}
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" class="mailbox-banner__link" :disabled="busy" @click="showOther = !showOther">
          {{ t('schools.ui.mailboxBanner.other', 'Use a different address') }}
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" class="mailbox-banner__link" @click="collapsed = true">
          {{ t('schools.ui.mailboxBanner.later', 'Later') }}
        </button>
      </div>
    </div>
    <form v-if="showOther" class="mailbox-banner__form mailbox-banner__form--other" @submit.prevent="resend(otherInput)">
      <input
        v-model="otherInput"
        class="mailbox-banner__input mailbox-banner__input--email"
        type="email"
        autocomplete="email"
        :placeholder="t('schools.ui.mailboxBanner.otherPlaceholder', 'you@somewhere-else.com')"
        :aria-label="t('schools.ui.mailboxBanner.otherLabel', 'Which address should we use?')"
      />
      <button type="submit" class="mailbox-banner__btn" :disabled="busy">
        {{ t('schools.ui.mailboxBanner.sendThere', 'Send it there') }}
      </button>
    </form>
    <p v-if="status" class="mailbox-banner__status" :class="`is-${statusKind}`">{{ status }}</p>
  </div>
</template>

<style scoped>
.mailbox-banner {
  padding: 10px max(16px, env(safe-area-inset-right, 0px)) 10px max(16px, env(safe-area-inset-left, 0px));
  background: #eef3fb;
  border-bottom: 1px solid rgba(60, 90, 140, 0.25);
  color: #24395c;
  font-size: 14px;
}
.mailbox-banner__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 16px;
}
.mailbox-banner__lead { margin: 0; }
.mailbox-banner__form { display: inline-flex; gap: 6px; align-items: center; }
.mailbox-banner__form--other { margin-top: 8px; justify-content: center; width: 100%; }
.mailbox-banner__input {
  width: 8.5em;
  padding: 6px 10px;
  border: 1px solid rgba(60, 90, 140, 0.4);
  border-radius: 8px;
  font: inherit;
  letter-spacing: 0.12em;
  background: #fff;
}
.mailbox-banner__input--email { width: 16em; letter-spacing: normal; }
.mailbox-banner__btn {
  padding: 6px 12px;
  border: 0;
  border-radius: 8px;
  background: #24395c;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.mailbox-banner__btn:disabled { opacity: 0.6; cursor: default; }
.mailbox-banner__links { display: inline-flex; gap: 8px; align-items: center; }
.mailbox-banner__link {
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.mailbox-banner__status { margin: 6px 0 0; text-align: center; }
.mailbox-banner__status.is-error { color: #8a2a1e; }
.mailbox-banner__status.is-done { color: #1f6b3a; font-weight: 600; }
</style>
