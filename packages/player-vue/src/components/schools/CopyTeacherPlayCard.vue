<script setup lang="ts">
// CopyTeacherPlayCard — the school leader's repair for a teacher who ran
// lessons signed in as themselves instead of using Play as class (Tom,
// 2026-09-11: "IF the teachers have by mistake played as themselves,
// Angharad needs to be able to copy all progress data and telemetry and
// everything to the play as class account").
//
// Flow: pick the teacher → see what would move (nothing written) → one
// confirm → a result line naming what was copied. The server owns the copy
// (api/school/copy-teacher-play/{preview,apply}); this card only asks and
// shows. Under View-as the preview works and the apply is refused with the
// server's own message, which is shown as-is: never a false "Copied".
import { ref, computed, watch } from 'vue'
import { getSchoolsClient } from '@/composables/schools/client'
import { useI18n } from '@/composables/useI18n'
import type { PanelState } from '@/views/schools/classDetailPanels'

const { t } = useI18n()

interface TeacherChoice { user_id: string; name: string }
// `teachersState` is what the class page's own teacher read came back as. An
// empty list is only "no teachers are linked" when that read resolved clean and
// empty — a failed or pending read must never be voiced as an empty class
// (nightly, 2026-09-11: this card said "No teachers" under a failed read while
// the panel beside it said "Couldn't load"). Absent, the list speaks for itself.
const props = withDefaults(defineProps<{ classId: string; teachers: TeacherChoice[]; teachersState?: PanelState }>(), {
  teachersState: undefined,
})
const listState = computed<PanelState>(() => props.teachersState ?? (props.teachers.length > 0 ? 'ready' : 'empty'))
const emit = defineEmits<{ (e: 'copied'): void }>()

interface PositionWords { known: string | null; target: string | null }
interface Preview {
  to_copy: Record<string, number>
  total_rows: number
  in_app_seconds: number
  prior_runs: number
  nothing_to_copy: boolean
  position: {
    teacher: PositionWords
    class: PositionWords
    resulting: PositionWords & { taken_from_teacher: boolean }
  }
}
interface Applied {
  copied: Record<string, number>
  total_rows: number
  in_app_seconds: number
  cursor_taken_from_teacher: boolean
  position: { class: PositionWords }
}

const pickedTeacherId = ref<string>(props.teachers[0]?.user_id ?? '')
watch(() => props.teachers, (list) => {
  if (!list.some((x) => x.user_id === pickedTeacherId.value)) pickedTeacherId.value = list[0]?.user_id ?? ''
})

const preview = ref<Preview | null>(null)
const applied = ref<Applied | null>(null)
const busy = ref(false)
const error = ref('')

// A new pick invalidates what was previewed for the old one.
watch(pickedTeacherId, () => { preview.value = null; applied.value = null; error.value = '' })

const pickedName = computed(() => props.teachers.find((x) => x.user_id === pickedTeacherId.value)?.name ?? '')

async function call(path: 'preview' | 'apply'): Promise<Record<string, any>> {
  const { data: { session } } = await getSchoolsClient().auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error(t('schools.copyPlay.notSignedIn', 'You are not signed in.'))
  const resp = await fetch(`/api/school/copy-teacher-play/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ class_id: props.classId, teacher_user_id: pickedTeacherId.value }),
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(body.error || `Request failed: ${resp.status}`)
  return body
}

async function runPreview(): Promise<void> {
  if (!pickedTeacherId.value || busy.value) return
  busy.value = true
  error.value = ''
  applied.value = null
  try {
    preview.value = (await call('preview')) as Preview
  } catch (e) {
    preview.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function runApply(): Promise<void> {
  if (!preview.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    applied.value = (await call('apply')) as Applied
    preview.value = null
    emit('copied')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function minutes(seconds: number): string {
  return String(Math.round(seconds / 60))
}

// Plain words for the rows that matter to a leader. Everything else the
// server copies is folded into "and the rest of the record".
function lines(counts: Record<string, number>): string[] {
  const out: string[] = []
  const n = (k: string) => counts[k] ?? 0
  if (n('sessions')) out.push(t('schools.copyPlay.sessions', '{n} sessions').replace('{n}', String(n('sessions'))))
  if (n('player_events')) out.push(t('schools.copyPlay.diary', '{n} moments in the app').replace('{n}', String(n('player_events'))))
  const progress = n('lego_progress') + n('seed_progress') + n('learner_lego_metrics')
  if (progress) out.push(t('schools.copyPlay.progress', '{n} pieces of course progress').replace('{n}', String(progress)))
  const rest = Object.entries(counts).filter(([k]) => !['sessions', 'player_events', 'lego_progress', 'seed_progress', 'learner_lego_metrics'].includes(k)).reduce((a, [, v]) => a + v, 0)
  if (rest) out.push(t('schools.copyPlay.rest', '{n} other records').replace('{n}', String(rest)))
  return out
}

function words(p: PositionWords | null | undefined): string {
  if (!p?.known && !p?.target) return t('schools.copyPlay.notStarted', 'not started yet')
  return [p.known, p.target].filter(Boolean).join(' / ')
}
</script>

<template>
  <div class="schools-card schools-card-pad rail-card copy-play-card">
    <div class="schools-kicker rail-kicker">{{ t('schools.copyPlay.kicker', 'Played as themselves by mistake?') }}</div>
    <p class="rail-note copy-play-intro">
      {{ t('schools.copyPlay.intro', 'If a teacher ran lessons signed in as themselves instead of using Play as class, copy that play onto this class so the class shows where it really is.') }}
    </p>

    <label class="copy-play-label" for="copy-play-teacher">{{ t('schools.copyPlay.teacherLabel', 'Teacher') }}</label>
    <select id="copy-play-teacher" v-model="pickedTeacherId" class="teacher-select copy-play-select" :disabled="busy || teachers.length === 0" data-walk="class-copy-play-picker">
      <option v-for="x in teachers" :key="x.user_id" :value="x.user_id">{{ x.name }}</option>
    </select>
    <p v-if="listState === 'loading'" class="rail-note schools-subtle">{{ t('schools.copyPlay.teachersLoading', 'Loading the teacher list…') }}</p>
    <p v-else-if="listState === 'error'" class="rail-note schools-subtle">{{ t('schools.copyPlay.teachersError', "Couldn't load the teacher list, so there is nobody to pick yet. Try refreshing.") }}</p>
    <p v-else-if="listState === 'empty'" class="rail-note schools-subtle">{{ t('schools.copyPlay.noTeachers', 'No teachers are linked to this class yet.') }}</p>

    <!-- HANDBOOK Copy a teacher's own play onto the class
         section: running-classes
         roles: school_admin
         place: class-detail
         keywords: copy, teacher, play as class, progress, mistake, own account
         parts: class-copy-play-picker, class-copy-play-preview-result, class-copy-play-apply, class-copy-play-done
         What it's for. Putting right a class whose teacher ran lessons signed in as
         themselves instead of using Play as class, so the class carries the
         progress it really made.
         Where it is. The class page, the **Played as themselves by mistake?** card
         beside the roster.
         How you do it.
         1. Pick the teacher from the list.
         2. Tap **See what would move** and read the sessions, the time in the app
            and where the class will be afterwards.
         3. Tap **Copy onto the class**. One line tells you what was copied.
         Worth knowing. The teacher keeps their own record. Only play on this class's
         course moves, the class ends up at the further of the two places, and running
         it again copies nothing twice. While viewing as someone else you can see what
         would move but not copy it.
         checked: 31a59a41.64ae1935
    -->
    <div class="copy-play-actions">
      <button type="button" class="btn-ghost btn-small" data-walk="class-copy-play-preview" :disabled="busy || !pickedTeacherId" @click="runPreview">
        {{ busy && !preview ? t('schools.copyPlay.checking', 'Checking…') : t('schools.copyPlay.previewCta', 'See what would move') }}
      </button>
    </div>

    <div v-if="preview" class="copy-play-preview" data-walk="class-copy-play-preview-result">
      <template v-if="preview.nothing_to_copy">
        <p class="rail-note">
          {{ t('schools.copyPlay.nothing', 'Nothing to copy. Everything {name} did on this course is already on the class.').replace('{name}', pickedName) }}
        </p>
      </template>
      <template v-else>
        <p class="rail-note copy-play-heading">{{ t('schools.copyPlay.wouldMove', 'From {name} onto this class:').replace('{name}', pickedName) }}</p>
        <ul class="copy-play-list">
          <li v-for="line in lines(preview.to_copy)" :key="line">{{ line }}</li>
          <li v-if="preview.in_app_seconds > 0">{{ t('schools.copyPlay.minutes', '{n} minutes in the app').replace('{n}', minutes(preview.in_app_seconds)) }}</li>
        </ul>
        <p class="rail-note">
          <span class="copy-play-pos-label">{{ t('schools.copyPlay.teacherAt', 'Teacher has reached:') }}</span> {{ words(preview.position.teacher) }}<br />
          <span class="copy-play-pos-label">{{ t('schools.copyPlay.classAt', 'Class has reached:') }}</span> {{ words(preview.position.class) }}<br />
          <span class="copy-play-pos-label">{{ t('schools.copyPlay.afterAt', 'Class will be at:') }}</span> {{ words(preview.position.resulting) }}
        </p>
        <p v-if="preview.prior_runs > 0" class="rail-note schools-subtle">
          {{ t('schools.copyPlay.priorRuns', 'Copied before: only what is new since then will move.') }}
        </p>
        <button type="button" class="btn-play btn-small copy-play-confirm" data-walk="class-copy-play-apply" :disabled="busy" @click="runApply">
          {{ busy ? t('schools.copyPlay.copying', 'Copying…') : t('schools.copyPlay.applyCta', 'Copy onto the class') }}
        </button>
      </template>
    </div>

    <p v-if="applied" class="rail-note copy-play-done" data-walk="class-copy-play-done">
      <template v-if="applied.total_rows === 0">
        {{ t('schools.copyPlay.doneNothing', 'Nothing new to copy. The class already had all of it.') }}
      </template>
      <template v-else>
        {{ t('schools.copyPlay.done', 'Copied from {name}: {what}.').replace('{name}', pickedName).replace('{what}', [...lines(applied.copied), ...(applied.in_app_seconds > 0 ? [t('schools.copyPlay.minutes', '{n} minutes in the app').replace('{n}', minutes(applied.in_app_seconds))] : [])].join(', ')) }}
        {{ t('schools.copyPlay.doneAt', 'The class is now at: {where}.').replace('{where}', words(applied.position.class)) }}
      </template>
    </p>

    <p v-if="error" class="copy-play-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.copy-play-card { gap: 0; }
.copy-play-intro { margin-top: 0; }
.copy-play-label {
  display: block;
  margin-top: 12px;
  font-size: 12px;
  color: var(--schools-fg-2);
}
.copy-play-select { margin-top: 6px; width: 100%; max-width: 100%; }
.copy-play-actions { margin-top: 10px; }
.copy-play-preview {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--schools-line, rgba(44, 38, 34, 0.12));
}
.copy-play-heading { margin-top: 0; color: var(--schools-fg); }
.copy-play-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--schools-fg);
}
.copy-play-pos-label { color: var(--schools-fg-2); }
.copy-play-confirm { margin-top: 12px; }
.copy-play-done { color: var(--schools-fg); }
.copy-play-error {
  margin-top: 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--schools-red, #b3261e);
}
</style>
