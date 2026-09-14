<script setup lang="ts">
/**
 * "You are now playing as yourself" — across the top of the PLAYER, only
 * while own-account play is live, for a school staff account.
 *
 * Tom, 2026-09-14 16:17Z (job #683): "the 'You are now playing as yourself'
 * makes no sense when in dashboard view - they're not playing anything. that
 * warning should be on the dashboard top nav when the player is playing".
 * Job #662 had put the line on the teacher home whenever the week carried
 * own-account minutes. Own-account play happens at `/`, the immersive
 * player, which has no schools nav at all — so the live warning sits on the
 * player itself, and the past-tense own-practice line on the teacher home
 * stays as a fact about the week.
 *
 * "Playing" is the player's own transport state: LearningPlayer echoes
 * isAudioPlaying on the window as `ssi-play-state` for chrome outside its
 * tree, and this reads that — never a minutes figure. Play as class runs on
 * /schools/play, not here, so a session on this route is always the person's
 * own. Never under View As: a platform admin plays nothing in anyone's name.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useUserRole } from '@/composables/useUserRole'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()
const { isSchoolStaff } = useSchoolContext()
const { isViewingAs } = useUserRole()
const playing = ref(false)

function onPlayState(e: Event): void {
  playing.value = !!(e as CustomEvent<{ playing: boolean }>).detail?.playing
}
onMounted(() => window.addEventListener('ssi-play-state', onPlayState))
onBeforeUnmount(() => window.removeEventListener('ssi-play-state', onPlayState))

const show = computed(() => playing.value && isSchoolStaff.value && !isViewingAs.value)
</script>

<template>
  <!-- HANDBOOK Told when you are playing as yourself
       section: running-classes
       roles: teacher, school_admin
       place: library
       keywords: playing as yourself, own account, play as class, warning, banner, player
       What it's for. A line across the top of the player while a lesson is
       running on your own sign-in rather than on the class, so it is noticed
       before the minutes land on you. It reads: You are now playing as
       yourself. If you want to play as class please go here.
       Where it is. Across the top of the player, only while it is playing on
       your own account. Your dashboard never shows it: nothing is playing there.
       How you do it.
       1. Read the line.
       2. Tap **Your classes** to go to your classes, and start the lesson with
          **Play as class** there.
       Worth knowing. The line goes as soon as you pause or stop. Minutes already
       played on your own account are not moved by it; the copy tool on a class's
       tools page does that if you want it.
       checked: 7e487ab8.251a1df2
  -->
  <div v-if="show" class="playing-as-yourself" role="status" data-walk="player-playing-as-yourself">
    <span>{{ t('schools.dashboard.playingAsYourself', 'You are now playing as yourself. If you want to play as class please go here.') }}</span>
    <router-link to="/schools/classes" class="playing-as-yourself-link">{{ t('schools.dashboard.playingAsYourselfLink', 'Your classes') }}</router-link>
  </div>
</template>

<style scoped>
/* Edge-anchored chrome pads out of the iOS status bar and notch (standing
   rule, CLAUDE.md "ALWAYS respect phone safe areas"). */
.playing-as-yourself {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 60;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 14px;
  padding: calc(8px + env(safe-area-inset-top, 0px)) max(14px, env(safe-area-inset-right, 0px)) 8px max(14px, env(safe-area-inset-left, 0px));
  background: #b45309;
  color: #fff;
  font-size: 14px;
  line-height: 1.35;
  text-align: center;
}
.playing-as-yourself-link {
  color: #fff;
  font-weight: 600;
  text-decoration: underline;
  white-space: nowrap;
}
</style>
