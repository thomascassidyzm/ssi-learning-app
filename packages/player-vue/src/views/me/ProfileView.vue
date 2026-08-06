<script setup lang="ts">
/**
 * ProfileView — the learner's motivation/profile surface. Founder-commissioned
 * design build, 2026-08-03.
 *
 * THREE LAYERS, THREE ENERGIES, in this order down the page:
 *   1. CELEBRATE ADHERENCE (dog energy) — showing up and having a go is the
 *      only thing that gets celebrated. Return is welcomed; absence is never
 *      mentioned, and cannot be, because the data model has no way to say it.
 *   2. REFLECT EXECUTION (the mirror) — honest, warm, unrewarded. In the first
 *      ~30 hours its job is accelerating extrapolation: show the curve before
 *      the learner can feel it, so belief outruns doubt.
 *   3. ESTIMATE LEVEL (the portrait) — difficulty x execution, with course
 *      position as the difficulty term, surfaced as a notional band whose
 *      interval visibly narrows. Never a test result.
 *
 * Then the plan, the two explainers, the language switcher, and the settings
 * direction sketch.
 *
 * PREVIEW SURFACE: this route is deliberately unlinked from every nav. Nothing
 * learner-visible changes until it is wired in — visiting /me is the flag.
 *
 * ACCEPTANCE TEST (the anti-gallery): nothing on this page, or in the payload
 * behind it, could ever generate a Duolingo-style shame email. If the system
 * could know 'streak: 0', the data model would be wrong — so it cannot.
 */
import { onMounted, computed, inject, type Ref } from 'vue'
import { useLearnerProfile, suggestedMode } from '@/composables/useLearnerProfile'
import AdherencePanel from '@/components/me/AdherencePanel.vue'
import MirrorPanel from '@/components/me/MirrorPanel.vue'
import PortraitPanel from '@/components/me/PortraitPanel.vue'
import PlanPanel from '@/components/me/PlanPanel.vue'
import HowThisWorksLearner from '@/components/me/HowThisWorksLearner.vue'
import WhyThisWorks from '@/components/me/WhyThisWorks.vue'
import CourseSwitchRow from '@/components/me/CourseSwitchRow.vue'
import SettingsDirection from '@/components/me/SettingsDirection.vue'

const supabaseClient = inject<Ref<any> | null>('supabase', null)
const activeCourse = inject<Ref<{ course_code?: string } | null> | null>('activeCourse', null)

async function getToken(): Promise<string | null> {
  const sb = supabaseClient?.value
  if (!sb) return null
  try {
    const { data: { session } } = await sb.auth.getSession()
    return session?.access_token ?? null
  } catch {
    return null
  }
}

const { profile, loading, hasMock, load } = useLearnerProfile(getToken)

const viewerId = computed(() => profile.value?.courseCode ?? 'anon')

// Mode guidance — where the learner sits on the 0-30 / 30-100 hour arc decides
// which routine gets the nudge. Guidance in the dog voice, bringing the right
// ball; never a score, never a correction of what they chose.
const nudge = computed(() =>
  profile.value ? suggestedMode(profile.value.plan.hoursDone) : null
)

onMounted(() => {
  void load(activeCourse?.value?.course_code ?? null)
})
</script>

<template>
  <div class="me">
    <header class="head">
      <h1 class="head-title">You</h1>
      <p v-if="hasMock" class="head-note">
        Some of this is sample data while your own numbers build up. It says so where it applies.
      </p>
    </header>

    <div v-if="loading && !profile" class="loading">Just a moment…</div>

    <template v-else-if="profile">
      <AdherencePanel :adherence="profile.adherence" />

      <MirrorPanel :mirror="profile.mirror" />

      <PortraitPanel :portrait="profile.portrait" />

      <p v-if="nudge" class="nudge">{{ nudge.line }}</p>

      <PlanPanel :plan="profile.plan" />

      <HowThisWorksLearner :viewer-id="viewerId" />
      <WhyThisWorks :viewer-id="viewerId" />

      <CourseSwitchRow />

      <SettingsDirection />
    </template>

    <footer class="foot">
      <router-link to="/" class="foot-link">Back to learning</router-link>
    </footer>
  </div>
</template>

<style scoped>
.me {
  min-height: 100vh;
  background: var(--bg-primary, #e8e3dd);
  padding: var(--space-5, 20px);
  /* Standing rule: edge-anchored chrome pads itself out of the phone safe
     areas, so nothing lands under the notch or the home indicator. */
  padding-top: calc(var(--space-5, 20px) + env(safe-area-inset-top, 0px));
  padding-bottom: calc(var(--space-8, 32px) + env(safe-area-inset-bottom, 0px));
  padding-left: max(var(--space-5, 20px), env(safe-area-inset-left, 0px));
  padding-right: max(var(--space-5, 20px), env(safe-area-inset-right, 0px));
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 16px);
  max-width: 560px;
  margin: 0 auto;
}
.head { display: flex; flex-direction: column; gap: 6px; }
.head-title {
  margin: 0;
  font-size: var(--text-2xl, 24px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
}
.head-note {
  margin: 0; font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078); line-height: 1.5;
}
.loading {
  padding: var(--space-6, 24px);
  text-align: center;
  color: var(--ink-tertiary, #8A8078);
  font-size: var(--text-sm, 13px);
}
.nudge {
  margin: 0;
  padding: var(--space-3, 12px) var(--space-4, 16px);
  border-left: 2px solid var(--accent-belt, #7C6A58);
  font-size: var(--text-base, 15px);
  line-height: 1.55;
  color: var(--ink-primary, #2C2622);
}
.foot { padding-top: var(--space-2, 8px); }
.foot-link {
  font-size: var(--text-sm, 13px);
  color: var(--ink-secondary, #6B635C);
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
