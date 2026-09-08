<script setup lang="ts">
/**
 * AccountContestPrompt — "was that you?" (job #371).
 *
 * Shown exactly once, in exactly one shape: a schools-minted account (a teacher
 * or admin who arrived by an invite link, no mail ever sent) has just been
 * signed into by a session that PROVED the mailbox by code, from a session the
 * mint did not hand out. Job #354 proved the server cannot tell "the teacher's
 * own second device" from "the real owner arriving at a squatted address" —
 * the two look identical — so the one party who knows is asked.
 *
 *   That was me  → the account is settled: address recorded as proved, the
 *                  marker retired, nothing destroyed, never asked again.
 *   Not me       → every credential and session on the account dies and this
 *                  person is handed a fresh one. The only thing lost is a
 *                  password somebody else set.
 *
 * Deliberately a card that can be closed: a teacher mid-lesson can dismiss it
 * and it returns at their next code sign-in, because nothing is settled until
 * they answer. The server never acts on this account without one of the two
 * words, and refuses both from anyone who did not prove the mailbox.
 */
import { computed, ref } from 'vue'
import { contestPending, answerContest } from '@/auth/claimAccount'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{ client: any }>()
const { t } = useI18n()

const busy = ref<'vouch' | 'contest' | null>(null)
const failed = ref(false)
const dismissed = ref(false)
const open = computed(() => !!contestPending.value && !dismissed.value)

async function answer(kind: 'vouch' | 'contest') {
  if (!props.client || busy.value) return
  busy.value = kind
  failed.value = false
  const ok = await answerContest(props.client, kind)
  busy.value = null
  if (!ok) failed.value = true
}
</script>

<template>
  <div v-if="open" class="contest-card" role="dialog" aria-live="polite">
    <p class="contest-title">{{ t('auth.contest.title', 'Was the earlier sign-in you?') }}</p>
    <p class="contest-body">
      {{ t('auth.contest.body', 'This account was set up from an invite link before this address was confirmed. If you set it up yourself on another device, keep everything. If you did not, we will clear the older sign-ins and password so only you have access.') }}
    </p>
    <p v-if="failed" class="contest-error">{{ t('auth.contest.failed', 'That did not go through. Please try again.') }}</p>
    <div class="contest-actions">
      <button type="button" class="contest-btn contest-btn-primary" :disabled="!!busy" @click="answer('vouch')">
        {{ busy === 'vouch' ? t('auth.contest.working', 'One moment…') : t('auth.contest.vouch', 'That was me') }}
      </button>
      <button type="button" class="contest-btn" :disabled="!!busy" @click="answer('contest')">
        {{ busy === 'contest' ? t('auth.contest.working', 'One moment…') : t('auth.contest.contest', 'Not me — secure my account') }}
      </button>
      <button type="button" class="contest-btn contest-btn-text" :disabled="!!busy" @click="dismissed = true">
        {{ t('auth.contest.later', 'Later') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.contest-card {
  position: fixed;
  left: max(12px, env(safe-area-inset-left, 0px));
  right: max(12px, env(safe-area-inset-right, 0px));
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 60;
  max-width: 520px;
  margin: 0 auto;
  padding: 16px 18px;
  border-radius: 14px;
  background: var(--bg-elevated, #fff);
  color: var(--text-primary, #1c2430);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
}
.contest-title { margin: 0 0 6px; font-weight: 700; font-size: 15px; }
.contest-body { margin: 0 0 12px; font-size: 13.5px; line-height: 1.45; color: var(--text-secondary, #47556a); }
.contest-error { margin: 0 0 10px; font-size: 13px; color: var(--accent-danger, #b3261e); }
.contest-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.contest-btn {
  font: inherit; font-size: 13.5px; padding: 8px 14px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--border-subtle, #d9d6d2); background: var(--bg-primary, #e8e3dd); color: inherit;
}
.contest-btn-primary { background: var(--accent-primary, #2b6cb0); color: #fff; border-color: transparent; }
.contest-btn-text { background: transparent; border-color: transparent; color: var(--text-secondary, #47556a); }
.contest-btn:disabled { opacity: 0.6; cursor: default; }
</style>
