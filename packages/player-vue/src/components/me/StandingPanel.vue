<script setup lang="ts">
/**
 * StandingPanel — where you are among the people who started when you did.
 *
 * This is the one comparison the SSi gamification doctrine allows.
 * `docs/gamification-done-right.md` bans leaderboards ("comparison anxiety;
 * competition over growth"), and `docs/methodology/insight-engine.md` §3.5
 * carves out exactly one exception — the *standing* widget, which shows "the
 * individual's own marker, the average, and the percentile", and exists "to
 * honour the handful really putting the time in and to let everyone feel part
 * of it — never a league table to climb."
 *
 * WHAT KEEPS IT ON THE RIGHT SIDE OF THAT LINE (all three enforced server-side,
 * see api/me/standing.ts):
 *   · it ranks PROGRESS THROUGH THE COURSE, never minutes — grinding cannot
 *     move it, so it cannot reward sitting there over understanding;
 *   · the underlying figure is a HIGH-WATER MARK, so it can never fall and can
 *     never express absence — a windowed percentile would be a streak in
 *     disguise, dropping while you were away;
 *   · it only ever counts who you are AHEAD of, never who is ahead of you.
 *
 * TWO THINGS THIS COMPONENT WILL NOT RENDER:
 *   1. A NUMBER FOR YOUR POSITION. Position is a LEGO, not a figure
 *      (`feedback_ssi_position_is_lego_not_seed` — "SEED position does not
 *      EXIST"), so the strip is purely relative: no seed counts, no ordinals,
 *      no course numbers anywhere on this panel.
 *   2. A PERCENTAGE BELOW THE HALFWAY MARK. Everyone gets the collective line
 *      ("you are one of N people…") because relatedness is for everyone; the
 *      percentage is additional and appears only when it is good news. That
 *      asymmetry is deliberate and is the doctrine's own — the widget exists to
 *      celebrate, and "you are further along than 8% of people" is a shortfall
 *      dressed as a statistic, which is the "not there yet" framing the
 *      doctrine explicitly bans. Selective, never false.
 *
 * When the server has no honest answer — cohort under the k-anonymity floor,
 * which is EVERY real learner on the live database today — this renders
 * nothing at all. Empty-with-honesty beats seeded (WORKLIST.md, Tom 2026-07-14).
 *
 * Interaction: none. Tap is the only affordance on this estate, and this panel
 * does not need even that — everything it has to say is on the face of it.
 */
import { ref, computed, watch, inject, type Ref } from 'vue'

const props = defineProps<{ courseCode?: string | null }>()

interface Standing {
  aheadOfPct: number
  cohortSize: number
  cohortKind: 'quarter' | 'course'
  cohortQuarter: string | null
  medianSeed: number
  seed: number
}

const standing = ref<Standing | null>(null)
const supabaseClient = inject<Ref<any> | null>('supabase', null)

/** Below this, the panel stays collective and drops the percentage. See header. */
const CELEBRATE_FROM_PCT = 50

async function load(courseCode: string | null | undefined): Promise<void> {
  standing.value = null
  if (!courseCode) return
  try {
    const sb = supabaseClient?.value
    if (!sb) return
    const { data: { session } } = await sb.auth.getSession()
    const token = session?.access_token
    if (!token) return

    const res = await fetch(`/api/me/standing?course=${encodeURIComponent(courseCode)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const body = await res.json()
    standing.value = body?.standing ?? null
  } catch {
    // A standing is never worth an error state. Silence is the honest default.
    standing.value = null
  }
}

watch(() => props.courseCode, (c) => { void load(c) }, { immediate: true })

const showPercentage = computed(
  () => !!standing.value && standing.value.aheadOfPct >= CELEBRATE_FROM_PCT
)

/**
 * Where the learner's marker sits along the strip. The strip IS the cohort,
 * ordered from earliest to furthest, so the learner sits at exactly the point
 * they are ahead of — which is self-consistent with the sentence above it and
 * leaks no one's actual position.
 */
const markerPct = computed(() => standing.value?.aheadOfPct ?? 0)

const cohortLine = computed(() => {
  const s = standing.value
  if (!s) return ''
  return s.cohortKind === 'quarter'
    ? `You are one of ${s.cohortSize} people who started this course around the same time as you.`
    : `You are one of ${s.cohortSize} people learning this course.`
})
</script>

<template>
  <section v-if="standing" class="panel">
    <p class="cohort">{{ cohortLine }}</p>

    <p v-if="showPercentage" class="hero">
      You are further along than
      <span class="hero-number">{{ standing.aheadOfPct }}%</span>
      of them.
    </p>

    <!-- The strip: the cohort ordered from earliest to furthest, the middle
         marked, and you on it. No numbers — position is a LEGO, not a figure. -->
    <div
      class="strip"
      role="img"
      :aria-label="showPercentage
        ? `You are further along than ${standing.aheadOfPct}% of ${standing.cohortSize} people who started around the same time as you.`
        : `Where you sit among ${standing.cohortSize} people who started around the same time as you.`"
    >
      <div class="strip-track">
        <div class="strip-middle" aria-hidden="true"></div>
        <div class="strip-marker" :style="{ left: markerPct + '%' }" aria-hidden="true">
          <span class="strip-you">You</span>
        </div>
      </div>
      <div class="strip-ends" aria-hidden="true">
        <span>just started</span>
        <span>furthest along</span>
      </div>
    </div>

    <p class="footnote">
      This compares how far through the course people have got — not how long
      anyone has spent in the app. It only ever goes up.
    </p>
  </section>
</template>

<style scoped>
.panel {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}
.cohort {
  margin: 0;
  font-size: var(--text-base, 15px);
  line-height: 1.5;
  color: var(--ink-secondary, #6B635C);
}
.hero {
  margin: 0;
  font-size: var(--text-lg, 17px);
  line-height: 1.45;
  color: var(--ink-primary, #2C2622);
}
.hero-number {
  font-size: var(--text-2xl, 24px);
  font-weight: var(--font-semibold, 600);
  color: var(--accent-belt, #7C6A58);
}
.strip { display: flex; flex-direction: column; gap: 6px; padding-top: 14px; }
.strip-track {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: linear-gradient(
    to right,
    var(--bg-primary, #e8e3dd),
    var(--accent-belt, #7C6A58)
  );
  opacity: 0.9;
}
.strip-middle {
  position: absolute;
  left: 50%;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: var(--ink-tertiary, #8A8078);
  opacity: 0.45;
}
.strip-marker {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: var(--accent-belt, #7C6A58);
  border: 2px solid var(--bg-elevated, #fff);
  transform: translateY(-50%);
}
.strip-you {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  font-size: var(--text-xs, 12px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
  white-space: nowrap;
}
.strip-ends {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078);
}
.footnote {
  margin: 0;
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
  color: var(--ink-tertiary, #8A8078);
}
</style>
