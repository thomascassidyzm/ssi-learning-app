<script setup lang="ts">
/**
 * SchoolsPasswordPrompt — "so you can always get back in".
 *
 * A teacher who arrived by an invite link or an admin-issued sign-in link has
 * a session and nothing else. The day that session dies — new laptop, cleared
 * storage, a phone reset — the only way back is a code emailed to an address
 * their school's mail gateway quarantines. That is how teachers end up locked
 * out of their own classes, and measured live on 2026-09-02 it is not
 * hypothetical: 81 accounts exist that asked for a code and never got in.
 *
 * A password is the one credential that needs no inbox at all. So we ask for
 * one, in the org lane's own already-approved voice — this reuses
 * ManagerOnboardingGate verbatim rather than growing a second password UI.
 *
 * Deliberately a PROMPT, not a gate. The org lane blocks a manager's first
 * write on this (Tom's ruling 2026-08-06, NodeActionBar.vue) and explicitly
 * left "the schools lane unchanged"; turning it into a wall for every teacher
 * in Wales is a product call, not a detail, so it stays an invitation here.
 * Dismissible, per-user, and it never nags twice in a session.
 */
import { computed, inject, ref } from 'vue'
import { t } from '@/composables/useI18n'
import ManagerOnboardingGate from '@/components/admin/ManagerOnboardingGate.vue'
import { hasPasswordFlag } from '@/composables/useManagerOnboarding'

const auth = inject<any>('auth', null)

const DISMISS_KEY_PREFIX = 'ssi-schools-password-prompt-dismissed:'

const userId = computed<string | null>(() => auth?.user?.value?.id ?? null)

function dismissKey(): string {
  return `${DISMISS_KEY_PREFIX}${userId.value || 'anon'}`
}

const dismissed = ref(false)
try {
  // Per-user, so a shared staffroom machine doesn't silence it for a colleague.
  dismissed.value = typeof localStorage !== 'undefined' && !!localStorage.getItem(`${DISMISS_KEY_PREFIX}${auth?.user?.value?.id || 'anon'}`)
} catch {
  /* private mode — a prompt is not worth throwing over */
}

const gateOpen = ref(false)

const show = computed(() => !!auth?.user?.value && !hasPasswordFlag(auth.user.value) && !dismissed.value)

function dismiss() {
  dismissed.value = true
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(dismissKey(), '1')
  } catch {
    /* ignore */
  }
}

function onPassworded() {
  gateOpen.value = false
  dismiss()
}
</script>

<template>
  <div v-if="show" class="pw-prompt schools-card schools-card-pad">
    <div class="pw-text">
      <div class="schools-kicker">{{ t('schools.setPasswordTitle', 'Set a password') }}</div>
      <p class="pw-body">
        {{ t('schools.setPasswordBody', 'Right now the only way back into this account is a code emailed to you — and school email filters often swallow those. A password takes ten seconds and always works.') }}
      </p>
    </div>
    <div class="pw-actions">
      <button type="button" class="btn-play btn-small" @click="gateOpen = true">{{ t('schools.setPasswordTitle', 'Set a password') }}</button>
      <button type="button" class="btn-ghost btn-small" @click="dismiss">{{ t('install.notNow', 'Not now') }}</button>
    </div>
  </div>
  <ManagerOnboardingGate :is-open="gateOpen" @passworded="onPassworded" @close="gateOpen = false" />
</template>

<style scoped>
.pw-prompt {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.pw-text {
  flex: 1 1 18rem;
  min-width: 0;
}
.pw-body {
  margin: 0.25rem 0 0;
  font-size: 0.9375rem;
  line-height: 1.45;
}
.pw-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
</style>
