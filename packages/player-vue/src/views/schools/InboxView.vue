<script setup lang="ts">
/**
 * The schools Inbox (job #684): messages sent to this person — a reply on the
 * school's Support thread, or the notice that their own play was copied onto
 * a class account, with its one-tap undo. Reached from the account menu.
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useI18n } from '@/composables/useI18n'
import UserMessageList from '@/components/messages/UserMessageList.vue'
import WalkOffer from '@/components/admin/WalkOffer.vue'
import { viewerPersona } from '@/walkthrough/handbook'

const { t } = useI18n()
const router = useRouter()
const { currentUser } = useSchoolContext()
// The Handbook's Show me lands here and defers its walk; this mount is what
// claims and starts it, and offers the walks for this place (job #881). Same
// claim as ClassDetail's HowThisWorks, at the persona the Handbook resolves.
const explainerPersona = computed(() => viewerPersona(currentUser.value?.platform_role ?? null, currentUser.value?.educational_role ?? null))
</script>

<template>
  <main class="inbox-screen">
    <header class="inbox-head">
      <h1 class="arsenal inbox-title">{{ t('schools.inbox.title', 'Inbox') }}</h1>
      <p class="inbox-lede">{{ t('schools.inbox.lede', 'Messages to you: replies on your Support thread, and anything we have done on your account that you might want to undo.') }}</p>
    </header>
    <WalkOffer :persona="explainerPersona" place="inbox" />
    <!-- HANDBOOK Read your messages
         section: your-own-account
         moment: something-wrong
         roles: teacher, school_admin, leader
         place: inbox
         keywords: inbox, messages, message, reply, replies, unread, undo, copied, notice
         What it's for. Reading what has been sent to you: a reply on your Support thread, or a notice that your own practice was copied onto a class account, with one tap to undo it.
         Where it is. **Inbox** in the account menu at the top right, under your name. The number beside it is how many you have not opened.
         How you do it.
         1. Tap your name at the top right, then **Inbox**.
         2. Tap a message to open it. Opening it is what marks it read.
         3. If the message offers **Undo** or **Open Support**, tap that.
         Worth knowing. A message stays unread until you open it, even after it has been on the list a while. Undo is offered only while it can be done cleanly; once the class account has been played since, it is not.
         checked: 685ea6d1.81f181f0
    -->
    <section class="schools-card schools-card-pad" data-walk="schools-inbox">
      <UserMessageList @open-support="router.push('/schools/support')" />
    </section>
  </main>
</template>

<style scoped>
.inbox-screen { display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px)); }
.inbox-head { display: flex; flex-direction: column; gap: 4px; }
.inbox-title { margin: 0; font-size: 22px; }
.inbox-lede { margin: 0; color: var(--schools-fg-2, #555); font-size: var(--text-sm); }
</style>
