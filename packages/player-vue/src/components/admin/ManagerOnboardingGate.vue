<script setup lang="ts">
/**
 * ManagerOnboardingGate — the two beats an org manager owes us before they
 * have built something they could lose. Decision logic and the WHY live in
 * composables/useManagerOnboarding.ts; this is the surface.
 *
 * Beat 1, PASSWORD: a gate with no skip. It opens in front of the first "add
 * a group" / "add a learner", explains in one plain sentence why (you came in
 * by a link — a password is how you get back), and on success hands control
 * straight back to the verb the manager was reaching for. They never have to
 * find the button again.
 *
 * Beat 2, INSTALL: a prompt, not a gate. Context-aware by device
 * (utils/installPlatform.ts) — desktop says app, mobile says home screen.
 * "Not now" is always there, dismissal is remembered per user, and an app
 * already running standalone skips the beat entirely.
 */
import { computed, inject, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
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

type Step = 'password' | 'install'
const step = ref<Step>('password')

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
    step.value = 'password'
  },
)

const wantsInstall = computed(() =>
  shouldPromptInstall({ standalone: platform.isStandalone, dismissed: dismissed.value }),
)

async function savePassword(): Promise<void> {
  if (saving.value) return
  const invalid = validatePassword(password.value, confirm.value)
  if (invalid) {
    error.value = invalid
    return
  }
  error.value = ''
  saving.value = true
  try {
    // Supabase may enforce a longer minimum than ours — surface its own words
    // rather than our guess at them.
    const result = await auth?.updatePassword?.(password.value)
    if (result?.error) {
      error.value = result.error
      return
    }
    // The verb the manager was reaching for runs NOW — they do not have to
    // find the button again.
    emit('passworded')
    if (wantsInstall.value) {
      step.value = 'install'
    } else {
      emit('close')
    }
  } catch {
    error.value = 'Could not save that password. Try again.'
  } finally {
    saving.value = false
  }
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
        <div class="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
          <!-- BEAT 1 — the gate. No close button, no overlay dismiss: the
               password is the one thing here that does not have a skip. -->
          <template v-if="step === 'password'">
            <h2 id="gate-title" class="gate-title">Create a password first</h2>
            <p class="gate-why">
              You came in by a link, and links expire. A password is how you get back into your
              organisation on your next device.
            </p>

            <form class="gate-form" @submit.prevent="savePassword">
              <label class="gate-label" for="gate-password">New password</label>
              <input
                id="gate-password"
                v-model="password"
                type="password"
                class="frost-input"
                autocomplete="new-password"
                :placeholder="`At least ${MIN_PASSWORD_LENGTH} characters`"
              />

              <label class="gate-label" for="gate-confirm">Confirm password</label>
              <input
                id="gate-confirm"
                v-model="confirm"
                type="password"
                class="frost-input"
                autocomplete="new-password"
                placeholder="Type it again"
              />

              <p v-if="error" class="gate-error" role="alert">{{ error }}</p>

              <button type="submit" class="btn-primary" :disabled="saving">
                {{ saving ? 'Saving…' : 'Save password and carry on' }}
              </button>
            </form>
          </template>

          <!-- BEAT 2 — the prompt. Always escapable. -->
          <template v-else>
            <h2 id="gate-title" class="gate-title">{{ framing.title }}</h2>
            <p class="gate-why">{{ framing.blurb }}</p>

            <div class="gate-actions">
              <button v-if="hasNativePrompt" type="button" class="btn-primary" @click="install">
                {{ framing.cta }}
              </button>
              <button v-else type="button" class="btn-primary" @click="openGuide">
                {{ framing.guideCta }}
              </button>
              <button type="button" class="btn-ghost" @click="skipInstall">Not now</button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gate-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
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
.gate {
  width: 100%;
  max-width: 420px;
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-xl, 20px);
  padding: var(--space-5, 24px);
  box-shadow: 0 24px 60px rgba(20, 17, 15, 0.24);
  color: var(--schools-fg, #0f1212);
}
.gate-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
}
.gate-why {
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--schools-fg-2, #555);
}
.gate-form { display: flex; flex-direction: column; gap: var(--space-2); }
.gate-label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--schools-fg-2, #555);
}
.frost-input {
  font: inherit;
  font-size: var(--text-sm);
  padding: 10px 12px;
  color: var(--schools-fg, #0f1212);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.14);
  border-radius: var(--radius-lg);
}
.frost-input:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}
.gate-error {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: rgb(var(--tone-red));
}
.gate-actions { display: flex; flex-direction: column; gap: var(--space-2); }
.btn-primary {
  margin-top: var(--space-3);
  padding: 12px 18px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border: none;
  border-radius: var(--radius-full, 999px);
  background: var(--schools-red, #db1e17);
  color: #fff;
  cursor: pointer;
}
.btn-primary:disabled { opacity: 0.55; cursor: wait; }
.gate-actions .btn-primary { margin-top: 0; }
.btn-ghost {
  padding: 10px 18px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  border: 1px solid rgba(44, 38, 34, 0.14);
  border-radius: var(--radius-full, 999px);
  background: transparent;
  color: var(--schools-fg-2, #555);
  cursor: pointer;
}
.gate-enter-active, .gate-leave-active { transition: opacity var(--transition-fast, 0.15s); }
.gate-enter-from, .gate-leave-to { opacity: 0; }
</style>
