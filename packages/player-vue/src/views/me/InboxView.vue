<script setup lang="ts">
/**
 * The learner Inbox (job #684), reached from the More page (/me) and from the
 * Library card. The same rows the schools inbox shows; a teacher who opens
 * the learner app sees the same message here.
 */
import { useRouter } from 'vue-router'
import { useI18n } from '@/composables/useI18n'
import UserMessageList from '@/components/messages/UserMessageList.vue'

const { t } = useI18n()
const router = useRouter()
</script>

<template>
  <div class="inbox">
    <header class="head">
      <h1 class="head-title">{{ t('inbox.title') }}</h1>
    </header>
    <UserMessageList @open-support="router.push('/schools/support')" />
    <footer class="foot">
      <router-link to="/me" class="foot-link">{{ t('inbox.backToYou') }}</router-link>
    </footer>
  </div>
</template>

<style scoped>
.inbox {
  min-height: 100vh;
  background: var(--bg-primary, #e8e3dd);
  padding: var(--space-5, 20px);
  /* Standing rule: pad out of the phone safe areas. */
  padding-top: calc(var(--space-5, 20px) + env(safe-area-inset-top, 0px));
  padding-bottom: calc(var(--space-8, 32px) + env(safe-area-inset-bottom, 0px));
  padding-left: max(var(--space-5, 20px), env(safe-area-inset-left, 0px));
  padding-right: max(var(--space-5, 20px), env(safe-area-inset-right, 0px));
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 16px);
}
.head-title { margin: 0; font-size: var(--text-xl, 22px); color: var(--ink-primary, #2C2622); }
.foot { padding-top: var(--space-2, 8px); }
.foot-link { font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); text-decoration: underline; text-underline-offset: 3px; }
</style>
