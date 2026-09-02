<script setup lang="ts">
/**
 * JoinWithCode — /join, the teacher's way back in.
 *
 * A school admin minted a short access code for a colleague and handed it over
 * on a channel our email cannot reach — Teams, a screen, a printed slip, said
 * out loud. This is where it gets spent.
 *
 * The two halves of Tom's ruling (2026-09-02) are both here, and neither works
 * without the other:
 *
 *   1. Redeeming mints a DURABLE session. "If the link is one-use and just
 *      lets them in once, you've solved nothing."
 *   2. The very first thing they then see asks them to set a password — the
 *      credential that needs no inbox and is theirs forever. Not a card
 *      further down some page that nobody scrolls to; the screen in front of
 *      them, at the one moment we know they are looking.
 *
 * It is COMPULSORY. One screen, once, and no way past it (Tom's ruling,
 * 2026-09-02, reversing an earlier skippable version of this screen). The
 * reasoning is worth carrying, because it is not a security argument: a
 * teacher who skips has a session on THIS ONE DEVICE and nothing else, so the
 * first dead session or new phone locks them out again — and what is behind
 * that door by then is their classes and their students' records, not five
 * minutes of their own time. Redemption is also the only moment we are
 * guaranteed their attention with a reason that obviously matters to them.
 *
 * Which is why the copy below talks about getting back to your classes and
 * never about security. That is the true reason as well as the persuasive one.
 */
import { computed, inject, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ManagerOnboardingGate from '@/components/admin/ManagerOnboardingGate.vue'

const route = useRoute()
const router = useRouter()
const auth = inject<any>('auth', null)
const supabase = inject<any>('supabase', ref(null))

type Step = 'entry' | 'redeeming' | 'credential' | 'done'

const step = ref<Step>('entry')
const rawCode = ref('')
const error = ref('')
const gateOpen = ref(false)

/**
 * Where they land once they are in. Everyone who can hold one of these codes
 * is school staff by construction — the mint refuses anyone who is not — so
 * the schools surface is their home, not the catalogue.
 */
const LANDING = '/schools'

const WHY_COPY =
  'You are in. One thing before you go, and then you are away: **set a password**. That code worked once and is now spent, and a password is what gets you back to your classes from any phone or any laptop, whenever you need them. Your students’ progress lives in here — this is how you keep reaching it.'

/** ABCD-EFGH as they type. Purely cosmetic; the server normalises anyway. */
const prettyCode = computed({
  get: () => rawCode.value,
  set: (v: string) => {
    const clean = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    rawCode.value = clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
  },
})

const canSubmit = computed(
  () => rawCode.value.replace(/[^A-Z0-9]/gi, '').length === 8 && step.value !== 'redeeming',
)

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const client = supabase.value
  if (!client) {
    error.value = 'The app is still starting up. Give it a moment and try again.'
    return
  }
  step.value = 'redeeming'
  error.value = ''
  try {
    // Any stale session on this device would fight the one we are about to
    // set. Local-scope only: we are not signing anybody out elsewhere.
    await client.auth.signOut({ scope: 'local' }).catch(() => {})

    const res = await fetch('/api/auth/access-code-redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: rawCode.value }),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok || !data?.success || !data?.session) {
      error.value = data?.error || 'That code did not work. Ask whoever gave it to you for a new one.'
      step.value = 'entry'
      return
    }

    const { error: setSessionError } = await client.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
    if (setSessionError) {
      error.value = setSessionError.message || 'Could not sign you in. Please try again.'
      step.value = 'entry'
      return
    }
    await auth?.refreshRole?.().catch?.(() => {})

    if (data.needs_credential === false) {
      finish()
      return
    }
    step.value = 'credential'
    gateOpen.value = true
  } catch {
    error.value = 'Could not reach us just now. Check your connection and try again.'
    step.value = 'entry'
  }
}

function finish(): void {
  step.value = 'done'
  gateOpen.value = false
  // The install walk can hand off to /install itself. Only claim the
  // navigation if we are still the ones on screen.
  if (router.currentRoute.value.path.startsWith('/join')) router.replace(LANDING)
}

onMounted(() => {
  // /join/ABCD-EFGH — the tappable half of what the admin was handed. Prefill
  // and let them press the button, rather than redeeming behind their back:
  // the code is single-use, and a link preview fetch must not burn it.
  const fromUrl = (route.params.code as string) || (route.query.code as string) || ''
  if (fromUrl) prettyCode.value = String(fromUrl)
})
</script>

<template>
  <div class="join-page">
    <div class="join-card">
      <template v-if="step === 'entry' || step === 'redeeming'">
        <h1 class="join-title">Your way in</h1>
        <p class="join-lede">
          Someone at your school made you an access code. Type it in below &mdash;
          no email, no waiting.
        </p>

        <form class="join-form" @submit.prevent="submit">
          <label class="join-label" for="join-code">Access code</label>
          <input
            id="join-code"
            v-model="prettyCode"
            class="join-input"
            type="text"
            inputmode="text"
            autocapitalize="characters"
            autocomplete="one-time-code"
            spellcheck="false"
            placeholder="ABCD-EFGH"
            :disabled="step === 'redeeming'"
          />
          <p v-if="error" class="join-error" role="alert">{{ error }}</p>
          <button type="submit" class="join-submit" :disabled="!canSubmit">
            {{ step === 'redeeming' ? 'Signing you in…' : 'Sign me in' }}
          </button>
        </form>

        <p class="join-foot">
          Codes last two days and work once. If yours has run out, whoever gave
          it to you can make another straight away.
        </p>
      </template>

      <template v-else>
        <h1 class="join-title">You&rsquo;re in</h1>
        <p class="join-lede">Setting up your way back to your classes.</p>
      </template>
    </div>

    <!--
      No allow-skip, and none exists: the password walk is not dismissible, so
      `close` can only arrive from the walk's own terminal beat, i.e. after the
      password is saved. `passworded` is deliberately NOT bound to finish —
      letting the walk play its closing beat is the point of using the walk
      genre at all, and navigating out from under it would cut that off.
    -->
    <ManagerOnboardingGate
      :is-open="gateOpen"
      :why-copy="WHY_COPY"
      @close="finish"
    />
  </div>
</template>

<style scoped>
.join-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Edge-anchored on a phone in standalone PWA — clear the notch and the home
     indicator, per the standing safe-area rule in CLAUDE.md. */
  padding:
    max(1.5rem, env(safe-area-inset-top, 0px))
    max(1.25rem, env(safe-area-inset-right, 0px))
    max(1.5rem, env(safe-area-inset-bottom, 0px))
    max(1.25rem, env(safe-area-inset-left, 0px));
  background: var(--bg-primary, #e8e3dd);
}
.join-card {
  width: 100%;
  max-width: 26rem;
  background: var(--surface-elevated, #fff);
  border-radius: 1rem;
  padding: 1.75rem 1.5rem;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}
.join-title {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.2;
  color: var(--text-primary, #1a1a1a);
}
.join-lede {
  margin: 0.5rem 0 1.5rem;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--text-secondary, #555);
}
.join-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.join-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary, #555);
}
.join-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.875rem 1rem;
  font-size: 1.375rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.12em;
  text-align: center;
  border: 1px solid var(--border-subtle, #d5d0c9);
  border-radius: 0.625rem;
  background: var(--bg-primary, #f6f4f1);
  color: var(--text-primary, #1a1a1a);
}
.join-input:focus {
  outline: 2px solid var(--accent, #6b7f5e);
  outline-offset: 1px;
}
.join-submit {
  margin-top: 0.5rem;
  padding: 0.875rem 1rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 0.625rem;
  background: var(--accent, #6b7f5e);
  color: #fff;
  cursor: pointer;
  /* A comfortable tap target at phone width. */
  min-height: 3rem;
}
.join-submit:disabled {
  opacity: 0.45;
  cursor: default;
}
.join-error {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--danger, #a33);
}
.join-foot {
  margin: 1.5rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-tertiary, #777);
}
</style>
