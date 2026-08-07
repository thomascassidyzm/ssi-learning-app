<script setup lang="ts">
/**
 * ManagerOnboardingGate — two short guided walk-throughs, in the app's own
 * teaching voice, at the moment a manager first needs them.
 *
 * Founder taste call (Tom, 2026-08-06 22:38Z) — binding on the UX: these two
 * steps must WALK THE MANAGER THROUGH in the app-as-teacher paradigm, "not a
 * bare form or a naked prompt". So each is a purpose sentence FIRST, then
 * under five paced steps to done, presented in the walkthrough engine's own
 * card genre — shared literally, via WalkCard.vue, so a manager cannot tell
 * this apart from the walk that showed them how to invite their first person.
 *
 * WHY IT IS NOT AN ENGINE WALK — the honest architectural note:
 * the walkthrough engine (walkthrough/useWalkthrough.ts) is an INVITATION
 * system by design. It never auto-plays (the compiler gate makes startWalk-
 * outside-@click a build failure), it never traps the page, and it anchors to
 * real elements the user can already see. The password step is the opposite
 * on every count: it fires unbidden, it blocks, and it has no skip — because
 * a manager who arrived by a magic link has no other way back into their
 * organisation. Routing it through the engine would have meant breaking the
 * never-auto-play gate, which is load-bearing. So the gate borrows the
 * engine's GENRE and VOICE, and the same two actions are ALSO registered as
 * real pack walks (set-your-password, install-the-app) offered the normal way
 * from How-this-works — that is where the coverage rule is satisfied.
 *
 * Decision logic and the WHY of the gate itself: useManagerOnboarding.ts.
 */
import { computed, inject, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import WalkCard from '@/components/admin/WalkCard.vue'
import {
  MIN_PASSWORD_LENGTH,
  useManagerOnboarding,
  shouldPromptInstall,
  validatePassword,
} from '@/composables/useManagerOnboarding'
import { detectFromBrowser, installFraming } from '@/utils/installPlatform'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: []; passworded: [] }>()

const auth = inject<any>('auth', null)
const router = useRouter()

const { dismissed, markInstallDismissed } = useManagerOnboarding(
  computed(() => auth?.user?.value ?? null),
)

const platform = detectFromBrowser()
const framing = computed(() => installFraming(platform))
const installPrompt = inject<{ value: any } | null>('installPrompt', null)
const hasNativePrompt = computed(() => !!installPrompt?.value)

// ─── The two walks, as data. Purpose sentence first, then the doing, then a
// terminal beat — the same shape as tools/walkthrough/walks/*.json. ───
type Beat = 'why' | 'do' | 'done'

const PASSWORD_WALK = {
  kicker: 'Set your password',
  beats: ['why', 'do', 'done'] as Beat[],
  say: {
    why: 'You got in here through a **link in an email**, and that link will not last. A password is how you get back into the organisation you are building — from a new laptop, a new phone, or after clearing your browser.',
    do: 'Choose a password you will remember. You will sign in with **your email address and this password** from now on.',
    done: 'Done — that is your way back in. Carrying straight on with what you were doing.',
  },
}

const INSTALL_WALK = computed(() => ({
  kicker: framing.value.title,
  beats: ['why', 'do'] as Beat[],
  say: {
    why: platform.surface === 'desktop'
      ? `${framing.value.blurb} It is the same organisation either way — this just saves you finding the tab every morning.`
      : `${framing.value.blurb} It is the same organisation either way — this just puts it a tap away.`,
    do: hasNativePrompt.value
      ? 'Your browser can do this for you now — one tap and it is done. You can remove it again any time, like any other app.'
      : 'It takes a couple of taps in your browser\'s own menu. Want me to show you where they are?',
    done: '',
  },
}))

type Phase = 'password' | 'install'
const phase = ref<Phase>('password')
const beat = ref(0)

const walk = computed(() => (phase.value === 'password' ? PASSWORD_WALK : INSTALL_WALK.value))
const currentBeat = computed<Beat>(() => walk.value.beats[beat.value] ?? 'why')
const say = computed(() => walk.value.say[currentBeat.value])

const password = ref('')
const confirm = ref('')
const error = ref('')
const saving = ref(false)

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return
    password.value = ''
    confirm.value = ''
    error.value = ''
    phase.value = 'password'
    beat.value = 0
  },
)

const wantsInstall = computed(() =>
  shouldPromptInstall({ standalone: platform.isStandalone, dismissed: dismissed.value }),
)

/** The password walk never offers an escape; the install walk always does. */
const dismissible = computed(() => phase.value === 'install')

const showBack = computed(() => beat.value > 0 && currentBeat.value !== 'done')

const nextLabel = computed(() => {
  if (phase.value === 'password') {
    if (currentBeat.value === 'why') return 'Next'
    if (currentBeat.value === 'do') return saving.value ? 'Saving…' : 'Save it'
    return 'Done'
  }
  return currentBeat.value === 'why' ? 'Next' : framing.value.cta
})

function back(): void {
  if (beat.value > 0) beat.value--
  error.value = ''
}

async function advance(): Promise<void> {
  if (phase.value === 'password') return advancePassword()
  return advanceInstall()
}

async function advancePassword(): Promise<void> {
  if (currentBeat.value === 'why') { beat.value = 1; return }

  if (currentBeat.value === 'done') {
    // The terminal beat hands over: either into the install walk, or out.
    if (wantsInstall.value) { phase.value = 'install'; beat.value = 0 } else { emit('close') }
    return
  }

  if (saving.value) return
  const invalid = validatePassword(password.value, confirm.value)
  if (invalid) { error.value = invalid; return }
  error.value = ''
  saving.value = true
  try {
    // Supabase may enforce a longer minimum than ours — surface its own words
    // rather than our guess at them.
    const result = await auth?.updatePassword?.(password.value)
    if (result?.error) { error.value = result.error; return }
    // The verb the manager was reaching for runs NOW — they never have to go
    // and find the button again.
    emit('passworded')
    beat.value = 2
  } catch {
    error.value = 'Could not save that password. Try again.'
  } finally {
    saving.value = false
  }
}

async function advanceInstall(): Promise<void> {
  if (currentBeat.value === 'why') { beat.value = 1; return }
  if (hasNativePrompt.value) return install()
  return openGuide()
}

async function install(): Promise<void> {
  const prompt = installPrompt?.value
  if (!prompt) return
  try {
    prompt.prompt()
    await prompt.userChoiceResult
  } catch {
    // Browser declined to show it — the walkthrough is still there.
  }
  skipInstall()
}

function openGuide(): void {
  markInstallDismissed()
  emit('close')
  router.push({ path: '/install', query: { return: router.currentRoute.value.fullPath } })
}

function skipInstall(): void {
  markInstallDismissed()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="gate">
      <div v-if="isOpen" class="gate-overlay">
        <div class="gate-mount" role="dialog" aria-modal="true" :aria-label="walk.kicker">
          <WalkCard
            :kicker="walk.kicker"
            :say="say"
            :step-count="walk.beats.length"
            :step-index="beat"
            :all-done="currentBeat === 'done'"
            :show-back="showBack"
            :next-label="nextLabel"
            :dismissible="dismissible"
            @back="back"
            @next="advance"
            @skip="skipInstall"
          >
            <!-- The doing, inside the card — the step is the form. -->
            <form
              v-if="phase === 'password' && currentBeat === 'do'"
              class="gate-form" @submit.prevent="advance"
            >
              <label class="gate-label" for="gate-password">New password</label>
              <input
                id="gate-password" v-model="password" type="password" class="frost-input"
                autocomplete="new-password" :placeholder="`At least ${MIN_PASSWORD_LENGTH} characters`"
              />
              <label class="gate-label" for="gate-confirm">Confirm password</label>
              <input
                id="gate-confirm" v-model="confirm" type="password" class="frost-input"
                autocomplete="new-password" placeholder="Type it again"
              />
              <p v-if="error" class="gate-error" role="alert">{{ error }}</p>
              <!-- Enter submits; the card's own Next is the visible verb. -->
              <button type="submit" class="gate-submit-proxy" tabindex="-1" aria-hidden="true"></button>
            </form>

            <div v-else-if="phase === 'install' && currentBeat === 'do'" class="gate-aside">
              <button type="button" class="gate-notnow" @click="skipInstall">Not now</button>
            </div>
          </WalkCard>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gate-overlay {
  position: fixed;
  inset: 0;
  z-index: 9600; /* above the walk overlay's 9500 — a gate outranks an invitation */
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 17, 15, 0.45);
  backdrop-filter: blur(4px);
  padding: max(var(--space-4), env(safe-area-inset-top, 0px))
    max(var(--space-4), env(safe-area-inset-right, 0px))
    max(var(--space-4), env(safe-area-inset-bottom, 0px))
    max(var(--space-4), env(safe-area-inset-left, 0px));
  overflow-y: auto;
}
.gate-mount { width: 100%; max-width: 400px; }

.gate-form { display: flex; flex-direction: column; gap: 6px; }
.gate-label {
  font-size: var(--text-xs); font-weight: var(--font-semibold);
  color: var(--schools-fg-2, #555);
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
.gate-error { margin: 2px 0 0; font-size: var(--text-xs); color: rgb(var(--tone-red)); }
.gate-submit-proxy { position: absolute; width: 0; height: 0; padding: 0; border: 0; opacity: 0; }

.gate-aside { display: flex; }
.gate-notnow {
  padding: 0; font: inherit; font-size: var(--text-xs); font-weight: var(--font-medium);
  background: none; border: none; color: var(--schools-fg-3, #8A8078);
  text-decoration: underline; text-decoration-color: rgba(44, 38, 34, 0.2); cursor: pointer;
}
.gate-notnow:hover { text-decoration-color: currentColor; }

.gate-enter-active, .gate-leave-active { transition: opacity var(--transition-fast, 0.15s); }
.gate-enter-from, .gate-leave-to { opacity: 0; }
</style>
