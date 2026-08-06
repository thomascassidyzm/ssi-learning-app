<script setup lang="ts">
/**
 * YourAccount — the permanent home for the two things an org leader owes
 * their own account: a password, and the app on their device.
 *
 * WHY THIS EXISTS (founder ruling, 2026-08-06): both actions already existed,
 * but ONLY inside ManagerOnboardingGate — the one-time first-login flow that
 * fires before a manager's first add. That flow is the right front door and
 * stays exactly as it is. What it could not be is a HOME: it fires once, it
 * is gone afterwards, and a walk cannot anchor to fields that only exist
 * while a modal is open. So a manager who skipped the install nudge, or who
 * wants to change a password six months later, had nowhere to go — and the
 * two actions could not be registered as pack walks at all.
 *
 * This is that durable surface. Same logic, second home:
 *   · password   — useManagerOnboarding's validatePassword + auth.updatePassword
 *   · install    — installPlatform's detectFromBrowser + installFraming
 * Nothing is re-implemented here; if the gate's rules change, these change
 * with them.
 *
 * The three data-walk anchors sit on the ROW containers, not the buttons, so
 * they exist in every state — including "already installed", where there is
 * no button to point at. A walk step must never find nothing.
 */
import { computed, inject, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  MIN_PASSWORD_LENGTH,
  hasPasswordFlag,
  validatePassword,
} from '@/composables/useManagerOnboarding'
import { detectFromBrowser, installFraming } from '@/utils/installPlatform'
import { isPlaceholderEmail } from '@/utils/placeholderEmail'

const auth = inject<any>('auth', null)
const installPrompt = inject<{ value: any } | null>('installPrompt', null)
const router = useRouter()

const user = computed(() => auth?.user?.value ?? null)
const hasPassword = computed(() => hasPasswordFlag(user.value))

// A link-auth placeholder is not an inbox — showing it would be a lie about
// where their sign-in link went.
const email = computed(() => {
  const e = user.value?.email as string | undefined
  return e && !isPlaceholderEmail(e) ? e : null
})

// ─── Password ───
const open = ref(false)
const password = ref('')
const confirm = ref('')
const error = ref('')
const saved = ref(false)
const saving = ref(false)

function togglePassword(): void {
  open.value = !open.value
  error.value = ''
  saved.value = false
  password.value = ''
  confirm.value = ''
}

async function savePassword(): Promise<void> {
  if (saving.value) return
  const invalid = validatePassword(password.value, confirm.value)
  if (invalid) { error.value = invalid; return }
  error.value = ''
  saving.value = true
  try {
    // Supabase may enforce its own minimum — surface its words, not ours.
    const result = await auth?.updatePassword?.(password.value)
    if (result?.error) { error.value = result.error; return }
    saved.value = true
    open.value = false
    password.value = ''
    confirm.value = ''
  } catch {
    error.value = 'Could not save that password. Try again.'
  } finally {
    saving.value = false
  }
}

// ─── Install ───
const platform = detectFromBrowser()
const framing = computed(() => installFraming(platform))
const hasNativePrompt = computed(() => !!installPrompt?.value)

async function install(): Promise<void> {
  const prompt = installPrompt?.value
  if (!prompt) return openGuide()
  try {
    prompt.prompt()
    await prompt.userChoiceResult
  } catch {
    // Browser declined to show it — the full walkthrough is still there.
    openGuide()
  }
}

function openGuide(): void {
  router.push({ path: '/install', query: { return: router.currentRoute.value.fullPath } })
}
</script>

<template>
  <section class="your-account schools-card schools-card-pad">
    <div class="account-head" data-walk="account-card">
      <span class="schools-kicker">Your account</span>
      <span v-if="email" class="account-email">{{ email }}</span>
    </div>

    <div class="account-row" data-walk="account-password">
      <div class="account-row-text">
        <span class="account-row-title">{{ hasPassword ? 'Password' : 'No password yet' }}</span>
        <span class="account-row-note">
          {{ hasPassword
            ? 'You can sign in with your email address and your password, on any device.'
            : 'You got in through a link. A password is how you get back in from a new laptop or phone.' }}
        </span>
      </div>
      <button type="button" class="account-verb" @click="togglePassword">
        {{ open ? 'Close' : (hasPassword ? 'Change it' : 'Set a password') }}
      </button>
    </div>

    <form v-if="open" class="account-form" @submit.prevent="savePassword">
      <label class="account-label" for="account-password-new">New password</label>
      <input
        id="account-password-new" v-model="password" type="password" class="frost-input"
        autocomplete="new-password" :placeholder="`At least ${MIN_PASSWORD_LENGTH} characters`"
      />
      <label class="account-label" for="account-password-confirm">Confirm password</label>
      <input
        id="account-password-confirm" v-model="confirm" type="password" class="frost-input"
        autocomplete="new-password" placeholder="Type it again"
      />
      <p v-if="error" class="account-error" role="alert">{{ error }}</p>
      <button type="submit" class="account-save" :disabled="saving || !password || !confirm">
        {{ saving ? 'Saving…' : 'Save password' }}
      </button>
    </form>
    <p v-else-if="saved" class="account-saved" role="status">Password saved.</p>

    <div class="account-row" data-walk="account-install">
      <div class="account-row-text">
        <span class="account-row-title">
          {{ platform.isStandalone ? 'The app is installed' : framing.title }}
        </span>
        <span class="account-row-note">
          {{ platform.isStandalone
            ? 'You are using the installed app right now — nothing more to do.'
            : framing.blurb }}
        </span>
      </div>
      <button
        v-if="!platform.isStandalone" type="button" class="account-verb"
        @click="hasNativePrompt ? install() : openGuide()"
      >{{ hasNativePrompt ? framing.cta : framing.guideCta }}</button>
    </div>
  </section>
</template>

<style scoped>
.your-account { display: flex; flex-direction: column; gap: var(--space-3); }
.account-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.account-email {
  font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.account-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  flex-wrap: wrap;
  padding-top: var(--space-3);
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}
.account-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 220px; }
.account-row-title {
  font-size: var(--text-sm); font-weight: var(--font-semibold);
  color: var(--ink-primary, #2C2622);
}
.account-row-note { font-size: var(--text-xs); color: var(--schools-fg-2, #555); line-height: 1.5; }

.account-verb {
  flex: 0 0 auto;
  padding: 7px 14px; font: inherit; font-size: var(--text-xs); font-weight: var(--font-semibold);
  border-radius: var(--radius-full, 999px); border: 1px solid rgba(44, 38, 34, 0.14);
  background: rgba(44, 38, 34, 0.04); color: var(--schools-fg-2, #555); cursor: pointer;
  white-space: nowrap;
}
.account-verb:hover { background: rgba(44, 38, 34, 0.10); }

.account-form { display: flex; flex-direction: column; gap: 6px; }
.account-label {
  font-size: var(--text-xs); font-weight: var(--font-semibold); color: var(--schools-fg-2, #555);
}
.frost-input {
  font: inherit; font-size: var(--text-sm); padding: 9px 12px;
  color: var(--schools-fg, #0f1212); background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.14); border-radius: var(--radius-lg);
}
.frost-input:focus {
  outline: none; border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}
.account-error { margin: 2px 0 0; font-size: var(--text-xs); color: rgb(var(--tone-red)); }
.account-saved { margin: 0; font-size: var(--text-xs); color: var(--schools-fg-2, #555); }
.account-save {
  align-self: flex-start; margin-top: 2px;
  padding: 7px 16px; font: inherit; font-size: var(--text-xs); font-weight: var(--font-semibold);
  border-radius: var(--radius-full, 999px); border: 1px solid transparent;
  background: var(--schools-red, #DB1E17); color: #fff; cursor: pointer;
}
.account-save:hover:not(:disabled) { background: var(--schools-red-deep, #b21611); }
.account-save:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
