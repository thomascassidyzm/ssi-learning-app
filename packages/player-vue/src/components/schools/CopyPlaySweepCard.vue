<script setup lang="ts">
// CopyPlaySweepCard — the school leader's sweep for every teacher who ran
// lessons signed in as themselves instead of using Play as class (job #662,
// Chepstow 2026-09-14: thirteen teachers had, and the copy tool had been run
// for none of them). Tom: "Angharad Jones as school admin SHOULD have a tool
// to copy any individual teacher account stats over to the play as class
// stats, including progress."
//
// One read lists every (class, teacher) pair with something to copy, each
// with the same preview figures the class page's card shows. Copying is ONE
// PAIR AT A TIME, on purpose: there is no select-all and no button that
// copies thirteen. Each row's Copy calls the existing apply for that pair and
// shows the server's own result line. Under View-as the list works and the
// copy is refused with the server's message, shown as-is.
import { ref, computed, onMounted } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useI18n } from '@/composables/useI18n'
import { callCopyTeacherPlay, copyLines, copyMinutes, positionLabel, copiedClause, type CopyCandidate, type CopyCandidates, type CopyApplied } from '@/composables/schools/copyTeacherPlay'

const { t } = useI18n()
const { currentUser } = useSchoolContext()
const emit = defineEmits<{ (e: 'copied'): void }>()

const state = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')
const candidates = ref<CopyCandidate[]>([])
const pairsChecked = ref(0)
const busyKey = ref('')
const doneByKey = ref<Record<string, CopyApplied>>({})
const errorByKey = ref<Record<string, string>>({})

const keyOf = (c: CopyCandidate) => `${c.class_id}|${c.teacher.user_id}`
const pending = computed(() => candidates.value.filter((c) => !doneByKey.value[keyOf(c)]))

async function load(): Promise<void> {
  state.value = 'loading'
  error.value = ''
  try {
    // Under View-as the fetch runs as the admin, whose own school is none,
    // so the persona's school goes on the body. A school admin's own call
    // sends nothing and the server resolves their school.
    const user = currentUser.value
    const body = user?._scopeSource === 'admin-view' && user.school_id ? { school_id: user.school_id } : {}
    const payload = (await callCopyTeacherPlay('candidates', body, t)) as CopyCandidates
    candidates.value = payload.candidates ?? []
    pairsChecked.value = payload.pairs_checked ?? 0
    state.value = 'ready'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    state.value = 'error'
  }
}
onMounted(load)

async function copy(c: CopyCandidate): Promise<void> {
  const key = keyOf(c)
  if (busyKey.value) return
  busyKey.value = key
  errorByKey.value = { ...errorByKey.value, [key]: '' }
  try {
    const applied = (await callCopyTeacherPlay('apply', { class_id: c.class_id, teacher_user_id: c.teacher.user_id }, t)) as CopyApplied
    doneByKey.value = { ...doneByKey.value, [key]: applied }
    emit('copied')
  } catch (e) {
    errorByKey.value = { ...errorByKey.value, [key]: e instanceof Error ? e.message : String(e) }
  } finally {
    busyKey.value = ''
  }
}

function doneLine(c: CopyCandidate): string {
  const applied = doneByKey.value[keyOf(c)]
  if (!applied) return ''
  if (applied.total_rows === 0) return t('schools.copyPlay.doneNothing', 'Nothing new to copy. The class already had all of it.')
  return `${t('schools.copyPlay.done', 'Copied from {name}: {what}.').replace('{name}', c.teacher.name).replace('{what}', copiedClause(applied, t))} ${t('schools.copyPlay.doneAt', 'The class is now at: {where}.').replace('{where}', positionLabel(applied.position.class, t))}`
}
</script>

<template>
  <!-- HANDBOOK Copy every teacher's own play onto their class
       section: running-classes
       roles: school_admin
       place: dashboard
       keywords: copy, sweep, teachers, play as class, own account, mistake, progress
       parts: school-copy-play-sweep-copy, school-copy-play-sweep-empty, school-copy-play-sweep-done
       What it's for. Finding every teacher in your school who ran lessons signed
       in as themselves instead of using Play as class, and moving that play onto
       their class, one teacher at a time. Each row names the class, the teacher,
       what would move, and where the class will be afterwards.
       Where it is. The schools dashboard, under the figures at the top.
       How you do it.
       1. Read down the rows. Each is one teacher on one class.
       2. Tap **Copy onto the class** on a row. One line tells you what was
          copied and where the class now is.
       3. Do the next row when you are ready. There is no button that copies
          everyone at once.
       Worth knowing. The teacher keeps their own record. Only play on that class's
       course moves, the class ends up at the further of the two places, and
       copying the same teacher again moves nothing twice. When there is nothing
       to copy the card says so in words. While viewing as someone else you can
       read the rows but not copy.
       checked: 7ea0b042.ce7fb63a
  -->
  <section class="schools-card schools-card-pad sweep-card" data-walk="school-copy-play-sweep">
    <div class="schools-kicker">{{ t('schools.copyPlay.sweepKicker', 'Lessons played on a teacher’s own account') }}</div>
    <p class="sweep-intro">{{ t('schools.copyPlay.sweepIntro', 'Each row is a teacher whose own account has practised the class’s course further than the class has. Copy moves that play onto the class, one teacher at a time. The teacher keeps their own record.') }}</p>

    <p v-if="state === 'loading'" class="schools-subtle sweep-note">{{ t('schools.copyPlay.sweepLoading', 'Checking every class and teacher…') }}</p>
    <p v-else-if="state === 'error'" class="sweep-error" role="alert">{{ t('schools.copyPlay.sweepError', 'Couldn’t check the teachers: {error}').replace('{error}', error) }}</p>
    <p v-else-if="candidates.length === 0" class="schools-subtle sweep-note" data-walk="school-copy-play-sweep-empty">{{ t('schools.copyPlay.sweepNothing', 'Nothing to copy. Every teacher’s lessons are already on their class accounts.') }}</p>
    <p v-else-if="pending.length === 0" class="schools-subtle sweep-note">{{ t('schools.copyPlay.sweepAllDone', 'All copied. Every row above is now on its class account.') }}</p>

    <ul v-if="state === 'ready' && candidates.length" class="sweep-list">
      <li v-for="c in candidates" :key="keyOf(c)" class="sweep-row" :data-testid="`sweep-row-${c.class_id}-${c.teacher.user_id}`">
        <div class="sweep-row-head">
          <span class="sweep-class arsenal">{{ c.class_name }}</span>
          <span class="sweep-teacher">{{ c.teacher.name }}</span>
        </div>
        <template v-if="!doneByKey[keyOf(c)]">
          <ul class="sweep-figures">
            <li v-for="line in copyLines(c.to_copy, t)" :key="line">{{ line }}</li>
            <li v-if="c.in_app_seconds > 0">{{ t('schools.copyPlay.minutes', '{n} minutes in the app').replace('{n}', copyMinutes(c.in_app_seconds)) }}</li>
          </ul>
          <p class="sweep-positions schools-subtle">
            {{ t('schools.copyPlay.teacherAt', 'Teacher has reached:') }} {{ positionLabel(c.position.teacher, t) }}<br />
            {{ t('schools.copyPlay.classAt', 'Class has reached:') }} {{ positionLabel(c.position.class, t) }}<br />
            {{ t('schools.copyPlay.afterAt', 'Class will be at:') }} {{ positionLabel(c.position.resulting, t) }}
          </p>
          <p v-if="c.prior_runs > 0" class="schools-subtle sweep-note">{{ t('schools.copyPlay.priorRuns', 'Copied before: only what is new since then will move.') }}</p>
          <button type="button" class="btn-play btn-small" data-walk="school-copy-play-sweep-copy" :disabled="!!busyKey" @click="copy(c)">
            {{ busyKey === keyOf(c) ? t('schools.copyPlay.copying', 'Copying…') : t('schools.copyPlay.applyCta', 'Copy onto the class') }}
          </button>
          <p v-if="errorByKey[keyOf(c)]" class="sweep-error" role="alert">{{ errorByKey[keyOf(c)] }}</p>
        </template>
        <p v-else class="sweep-done" data-walk="school-copy-play-sweep-done">{{ doneLine(c) }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.sweep-card { display: block; }
.sweep-intro { margin: 6px 0 0; font-size: 13px; line-height: 1.5; color: var(--schools-fg-2); }
.sweep-note { margin: 10px 0 0; font-size: 12.5px; }
.sweep-list { list-style: none; margin: 12px 0 0; padding: 0; }
.sweep-row { padding: 12px 0; border-top: 1px solid var(--schools-line, rgba(44, 38, 34, 0.12)); }
.sweep-row-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.sweep-class { font-size: 16px; }
.sweep-teacher { font-size: 13px; color: var(--schools-fg-2); }
.sweep-figures { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.6; color: var(--schools-fg); }
.sweep-positions { margin: 6px 0 0; font-size: 12.5px; line-height: 1.6; }
.sweep-row .btn-small { margin-top: 10px; }
.sweep-done { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--schools-fg); }
.sweep-error { margin: 8px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--schools-red, #b3261e); }
</style>
