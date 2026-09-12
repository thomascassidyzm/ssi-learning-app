<script setup lang="ts">
/**
 * QuestionFindings — the nightly Discovery findings, as cards at the top of
 * the question they concern.
 *
 * Design §2: the Discovery feed changes shape rather than dying — the engine
 * stays, the page goes. Each finding lands on the question its metric
 * answers, read from /api/intel/findings, which sorts them.
 *
 * THE SILENCE IS LOUD. The job that writes the findings runs from the
 * watson-1 systemd timer ssi-insight-discovery.timer (since 2026-09-12; it
 * was a launchd agent on Tom's Mac before that), and nothing here can restart
 * it. Its last row is dated 2026-08-31. Two missed nights mean it is dead
 * rather than late, and past that this component says so in the alarm
 * tone, with the real age, above findings drawn muted — never stale cards
 * dressed as fresh, and never a quiet "days ago" somebody has to notice.
 *
 * Owned by the layout, not by the page, so no question can forget its
 * findings and no question can show another's.
 */
import { computed, onMounted } from 'vue'
import { useIntelApi } from './useIntelApi'
import Pill from './Pill.vue'

interface Finding { title: string; story: string; tone: 'neutral' | 'good' | 'warn' | 'alarm'; question: string }
interface FindingsResponse {
  generatedAt: string | null
  ageHours: number | null
  silent: boolean
  byQuestion: Record<string, Finding[]>
}

const props = defineProps<{ question: string }>()

const { data, load } = useIntelApi<FindingsResponse>('/api/intel/findings')
onMounted(() => { void load() })

const findings = computed<Finding[]>(() => data.value?.byQuestion[props.question] ?? [])

const PILL_TONE = { neutral: 'quiet', good: 'good', warn: 'watch', alarm: 'alarm' } as const

const ageLine = computed<string | null>(() => {
  const d = data.value
  if (!d || !d.generatedAt) return d ? 'The nightly findings have never run.' : null
  const days = Math.floor((d.ageHours ?? 0) / 24)
  const when = new Date(d.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (!d.silent) return `Found overnight, ${when}.`
  return `The nightly findings have been silent since ${when}, ${days} days ago. The nightly job on watson-1 has stopped writing; what follows is the last thing it said.`
})
</script>

<template>
  <!-- HANDBOOK What the nightly findings say about this question
       section: seeing-progress
       roles: admin
       place: intel
       keywords: findings, discovery, nightly, claude, silent, stale, cards
       What it's for. Every night a job reads the week's practice and writes
       a handful of findings in plain words. Each one appears here on the
       question it is about, so you read the finding beside the number it
       is a finding about.
       Where it is. The cards between the verbs and the answer on a question
       page. A question with no findings shows nothing here.
       How you do it.
       1. Read the cards. Each carries a dot in one of four tones: good,
          watch, alarm or quiet.
       2. Read the line above them for when they were found.
       3. If that line is red, the nightly job has missed two nights or more
          and the findings are old. The job is not on this estate and cannot
          be restarted from here.
       Worth knowing. The numbers inside a finding were the job's own on the
       night; the page's own numbers are fetched fresh and may differ.
       checked: 49c62cb7.223f0da8
  -->
  <section v-if="findings.length || data?.silent" class="findings" :class="{ silent: data?.silent }" data-intel="findings">
    <p v-if="ageLine" class="age" :class="{ alarm: data?.silent }">{{ ageLine }}</p>
    <article v-for="(f, i) in findings" :key="i" class="finding">
      <Pill :tone="PILL_TONE[f.tone]">{{ f.tone === 'warn' ? 'watch' : f.tone === 'neutral' ? 'quiet' : f.tone }}</Pill>
      <p class="title arsenal">{{ f.title }}</p>
      <p v-if="f.story" class="story">{{ f.story }}</p>
    </article>
  </section>
</template>

<style scoped>
.findings { display: flex; flex-direction: column; gap: 10px; }
.age { margin: 0; font-size: 12.5px; color: var(--schools-fg-3); }
.age.alarm { color: var(--intel-alarm); font-weight: 600; }
.finding {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.silent .finding { opacity: 0.72; }
.title { margin: 0; font-size: 17px; line-height: 1.3; color: var(--schools-fg); }
.story { margin: 0; font-size: 13.5px; line-height: 1.45; color: var(--schools-fg-2); }
</style>
