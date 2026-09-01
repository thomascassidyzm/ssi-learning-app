<script setup lang="ts">
/**
 * SectorPicker — choose a sector walk, then the part you play in it.
 *
 * A sector walk is a thread of material about the learner's own line of work
 * that runs ALONGSIDE the core course from the start. The whole point is
 * immediacy: a nurse gets nursing material in her first sessions rather than
 * after thirty hours of core seeds. So this picker is two taps and no reading.
 *
 * Presentational by design: it holds only which step it is on. The walks, the
 * threads and the writes all live in useSectorThread(), and whoever mounts this
 * passes them down and handles `choose`. That keeps this component testable
 * without a network and keeps the composable the single owner of thread state.
 *
 * Copy laws that apply here — zero explanation, no parentheses anywhere in
 * learner-facing text, and position is NEVER a number and never the words
 * "seed" or "lego": a walk that has not opened yet shows the anchor's own
 * content, in both languages, and nothing else.
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

// Structurally identical to SectorOption in composables/useSectorThread.ts.
// Declared here so the picker can be mounted and tested on its own.
interface SectorOptionLike {
  slug: string
  sectorCourseCode: string
  roles: string[]
  status: 'draft' | 'live'
  anchor: { legoId: string; known: string; target: string } | null
}

const props = withDefaults(defineProps<{
  open: boolean
  sectors: SectorOptionLike[]
  loading?: boolean
  error?: string | null
  /** The learner's core position: the highest LEGO they have actually played. */
  coreHighestLegoId?: string | null
  /** The walk already chosen, if any, so reopening lands on what they picked. */
  currentSectorCourseCode?: string | null
  currentRole?: string | null
}>(), {
  loading: false,
  error: null,
  coreHighestLegoId: null,
  currentSectorCourseCode: null,
  currentRole: null,
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'retry'): void
  (e: 'choose', payload: { slug: string; sectorCourseCode: string; role: string }): void
}>()

// Draft walks are being written and are not for learners yet; status is exactly
// what that flag is for. An empty list after this filter is CORRECT — the shell
// ships before any walk is registered.
const visibleSectors = computed(() => props.sectors.filter(s => s.status === 'live'))

const step = ref<'walks' | 'role'>('walks')
const chosen = ref<SectorOptionLike | null>(null)
const role = ref('general')

// Every opening starts at the walk list, on the walk they already have.
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  const current = props.currentSectorCourseCode
    ? visibleSectors.value.find(s => s.sectorCourseCode === props.currentSectorCourseCode) ?? null
    : null
  chosen.value = current
  role.value = props.currentRole || 'general'
  step.value = 'walks'
}, { immediate: true })

// LEGO ids are fixed width — S0084L01 — so ordering them as text orders them as
// positions. No core position yet means nothing has opened yet.
const isOpenYet = (s: SectorOptionLike) => {
  if (!s.anchor) return true
  const here = props.coreHighestLegoId
  return !!here && here >= s.anchor.legoId
}

const walkName = (s: SectorOptionLike) =>
  t(`sector.walks.${s.slug}`, s.slug.charAt(0).toUpperCase() + s.slug.slice(1))

const roleName = (r: string) =>
  t(`sector.roles.${r}`, r.charAt(0).toUpperCase() + r.slice(1))

const roleDesc = (r: string) => {
  const key = `sector.roleDescs.${r}`
  const v = t(key, '')
  return v === key ? '' : v
}

// A walk with one role still shows the role step: one look, one tap to confirm.
const roles = computed(() => {
  const rs = chosen.value?.roles ?? []
  return rs.length ? rs : ['general']
})

const pickWalk = (s: SectorOptionLike) => {
  chosen.value = s
  role.value = roles.value.includes(props.currentRole || '') ? (props.currentRole as string) : 'general'
  step.value = 'role'
}

const confirm = () => {
  const s = chosen.value
  if (!s) return
  emit('choose', { slug: s.slug, sectorCourseCode: s.sectorCourseCode, role: role.value })
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (step.value === 'role') { step.value = 'walks'; return }
  emit('close')
}

watch(() => props.open, (isOpen) => {
  if (isOpen) document.addEventListener('keydown', onKeydown)
  else document.removeEventListener('keydown', onKeydown)
}, { immediate: true })
</script>

<template>
  <!-- Teleported to <body> and above the nav layer, like the offline depth
       picker: the tray that opened it lives inside a transformed ancestor, so
       anything local would be trapped in that containing block. -->
  <Teleport to="body">
    <Transition name="sector-picker">
      <div
        v-if="open"
        class="sector-picker-backdrop"
        @click.self="emit('close')"
      >
        <div class="sector-picker" role="dialog" :aria-label="t('sector.title')">
          <div class="sector-picker-head">
            <button
              v-if="step === 'role'"
              class="sector-picker-back"
              :aria-label="t('sector.back')"
              @click="step = 'walks'"
            >‹</button>
            <h3 class="sector-picker-title">
              {{ step === 'role' ? t('sector.roleTitle') : t('sector.title') }}
            </h3>
            <button class="sector-picker-close" :aria-label="t('sector.close')" @click="emit('close')">✕</button>
          </div>
          <p class="sector-picker-sub">
            {{ step === 'role' ? t('sector.roleSubtitle') : t('sector.subtitle') }}
          </p>

          <!-- STEP 1 — the walks in this language -->
          <div v-if="step === 'walks'" class="sector-picker-body">
            <p v-if="loading" class="sector-state">{{ t('sector.loading') }}</p>

            <div v-else-if="error" class="sector-state">
              <p class="sector-state-title">{{ t('sector.errorTitle') }}</p>
              <p class="sector-state-body">{{ t('sector.errorBody') }}</p>
              <button class="sector-retry" @click="emit('retry')">{{ t('sector.retry') }}</button>
            </div>

            <!-- The empty state is a screen in its own right, not a failure. -->
            <div v-else-if="visibleSectors.length === 0" class="sector-state sector-empty">
              <p class="sector-state-title">{{ t('sector.emptyTitle') }}</p>
              <p class="sector-state-body">{{ t('sector.emptyBody') }}</p>
            </div>

            <template v-else>
            <button
              v-for="s in visibleSectors"
              :key="s.sectorCourseCode"
              class="sector-walk"
              :class="{ chosen: chosen?.sectorCourseCode === s.sectorCourseCode }"
              @click="pickWalk(s)"
            >
              <span class="sector-walk-name">{{ walkName(s) }}</span>
              <!-- Not open yet: say what it opens after, in the learner's own
                   two languages. Never a number, never a position word. -->
              <span v-if="!isOpenYet(s) && s.anchor" class="sector-walk-gate">
                <span class="sector-walk-gate-label">{{ t('sector.opensAfter') }}</span>
                <span class="sector-walk-gate-known">{{ s.anchor.known }}</span>
                <span class="sector-walk-gate-target">{{ s.anchor.target }}</span>
              </span>
            </button>
            </template>
          </div>

          <!-- STEP 2 — the part you play. General is chosen for you. -->
          <div v-else class="sector-picker-body">
            <button
              v-for="r in roles"
              :key="r"
              class="sector-role"
              :class="{ chosen: role === r }"
              :aria-pressed="role === r"
              @click="role = r"
            >
              <span class="sector-role-name">{{ roleName(r) }}</span>
              <span v-if="roleDesc(r)" class="sector-role-desc">{{ roleDesc(r) }}</span>
            </button>
            <button class="sector-start" @click="confirm">{{ t('sector.start') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sector-picker-backdrop {
  position: fixed;
  inset: 0;
  /* Above the bottom-nav / belt-skip / paywall layer, like the offline picker,
     so the dialog asking for input is always reachable. */
  z-index: 3100;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Never let the notch or the home indicator clip the dialog. */
  padding: max(24px, env(safe-area-inset-top, 0px)) max(24px, env(safe-area-inset-right, 0px))
           max(24px, env(safe-area-inset-bottom, 0px)) max(24px, env(safe-area-inset-left, 0px));
  background: rgba(0, 0, 0, 0.55);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}
.sector-picker {
  width: 100%;
  max-width: 340px;
  background: rgba(255, 255, 255, 0.98);
  border: 1.5px solid rgba(0, 0, 0, 0.1);
  border-radius: 18px;
  padding: 18px 18px 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
}
.sector-picker-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.sector-picker-title {
  margin: 0;
  flex: 1;
  font-size: 17px;
  font-weight: 700;
  color: #2b2622;
}
.sector-picker-back,
.sector-picker-close {
  border: none;
  background: transparent;
  font-size: 15px;
  line-height: 1;
  color: #9a948e;
  cursor: pointer;
  padding: 4px;
  -webkit-tap-highlight-color: transparent;
}
.sector-picker-back { font-size: 22px; }
.sector-picker-sub {
  margin: 4px 0 14px;
  font-size: 13px;
  color: #6b6560;
  flex-shrink: 0;
}
.sector-picker-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  min-height: 0;
}

.sector-state {
  margin: 0;
  padding: 10px 2px 4px;
  font-size: 13px;
  color: #6b6560;
}
.sector-state-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: #2b2622;
}
.sector-state-body { margin: 0; }
.sector-retry {
  margin-top: 12px;
  border: 1.5px solid rgba(0, 0, 0, 0.12);
  background: transparent;
  border-radius: 12px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #2b2622;
  cursor: pointer;
}

.sector-walk,
.sector-role {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border: 1.5px solid rgba(0, 0, 0, 0.1);
  border-radius: 14px;
  background: transparent;
  cursor: pointer;
  color: #2b2622;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.sector-walk.chosen,
.sector-role.chosen {
  border-color: rgba(22, 163, 74, 0.5);
  background: rgba(22, 163, 74, 0.06);
}
.sector-walk-name,
.sector-role-name {
  font-size: 15px;
  font-weight: 600;
}
.sector-walk-gate {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 4px;
  font-size: 12px;
  color: #6b6560;
}
.sector-walk-gate-label { color: #a09a94; }
.sector-walk-gate-target { font-weight: 600; color: #2b2622; }
.sector-role-desc {
  font-size: 12px;
  color: #6b6560;
}

.sector-start {
  margin-top: 8px;
  border: none;
  border-radius: 14px;
  padding: 12px 16px;
  background: #16a34a;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.sector-picker-enter-active,
.sector-picker-leave-active { transition: opacity 0.2s ease; }
.sector-picker-enter-from,
.sector-picker-leave-to { opacity: 0; }
</style>
