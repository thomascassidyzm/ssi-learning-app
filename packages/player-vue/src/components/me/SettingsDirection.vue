<script setup lang="ts">
/**
 * SettingsDirection — a direction sketch, not a rebuild.
 *
 * Audit (2026-08-03, against the live SettingsScreen.vue): 38 rendered rows,
 * of which 3 are genuine learner preferences (interface language, learning
 * speed, personalised pacing) and 35 are account, billing, dev and legal
 * plumbing. The 3 real ones are wired here to the SAME persistence keys
 * SettingsScreen.vue already uses — this panel is a quieter front door onto
 * the same choices, not a parallel settings store.
 */
import { ref, computed } from 'vue'
import { setLocale } from '@/composables/useI18n'

const LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'cym', label: 'Cymraeg' },
  { code: 'spa', label: 'Español' },
  { code: 'fra', label: 'Français' },
  { code: 'deu', label: 'Deutsch' },
  { code: 'ita', label: 'Italiano' },
  { code: 'por', label: 'Português' },
]
const currentLang = ref(localStorage.getItem('ssi-locale') || 'eng')
function chooseLang(code: string) {
  currentLang.value = code
  setLocale(code)
}

const SPEEDS = [
  { value: 0.8, label: 'Slower' },
  { value: 1.0, label: 'Normal' },
  { value: 1.1, label: 'Faster' },
]
const currentSpeed = ref(parseFloat(localStorage.getItem('learner_speed') || '1.0'))
function chooseSpeed(value: number) {
  currentSpeed.value = value
  if (value === 1.0) localStorage.removeItem('learner_speed')
  else localStorage.setItem('learner_speed', String(value))
}

const pacingOn = ref(localStorage.getItem('ssi-adaptation-consent') === 'true')
function togglePacing() {
  pacingOn.value = !pacingOn.value
  localStorage.setItem('ssi-adaptation-consent', pacingOn.value ? 'true' : 'false')
}

const showRest = ref(false)
const restCategories = [
  'Account and signing in',
  'Billing and subscription',
  'Course tools and codes',
  'Fixing audio or loading problems',
  'Legal and the small print',
]

const restLine = computed(() =>
  showRest.value
    ? 'Still here, just tucked away — none of this needed a light on it.'
    : 'A handful more things live here — nothing you need to think about often.'
)
</script>

<template>
  <section class="panel">
    <h2 class="title">Settings, the quiet version</h2>
    <p class="lede">Three things actually change how you learn. Everything else just needs to work.</p>

    <div class="pref">
      <div class="pref-head">
        <span class="pref-label">Language you read in</span>
        <span class="pref-desc">The words around the lesson — not what you're learning.</span>
      </div>
      <div class="chip-row">
        <button
          v-for="lang in LANGUAGES"
          :key="lang.code"
          type="button"
          class="chip"
          :class="{ active: currentLang === lang.code }"
          @click="chooseLang(lang.code)"
        >{{ lang.label }}</button>
      </div>
    </div>

    <div class="pref">
      <div class="pref-head">
        <span class="pref-label">How fast things play</span>
        <span class="pref-desc">Slows the language you're learning down. Never the explanations.</span>
      </div>
      <div class="chip-row">
        <button
          v-for="s in SPEEDS"
          :key="s.value"
          type="button"
          class="chip"
          :class="{ active: currentSpeed === s.value }"
          @click="chooseSpeed(s.value)"
        >{{ s.label }}</button>
      </div>
    </div>

    <div class="pref">
      <div class="pref-row" @click="togglePacing">
        <div class="pref-head">
          <span class="pref-label">Give me a moment</span>
          <span class="pref-desc">Listens for when you start talking and waits accordingly. Nothing is recorded.</span>
        </div>
        <div class="toggle-switch" :class="{ 'is-on': pacingOn }">
          <div class="toggle-track"><div class="toggle-thumb"></div></div>
        </div>
      </div>
    </div>

    <button type="button" class="rest-toggle" @click="showRest = !showRest">
      {{ restLine }}
    </button>
    <ul v-if="showRest" class="rest-list">
      <li v-for="c in restCategories" :key="c">{{ c }}</li>
    </ul>
    <p v-if="showRest" class="sketch-note">
      A direction sketch only — these labels aren't live controls here yet.
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
  gap: var(--space-4, 16px);
}
.title {
  margin: 0;
  font-size: var(--text-lg, 17px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
}
.lede {
  margin: -8px 0 0;
  font-size: var(--text-sm, 13px);
  color: var(--ink-secondary, #6B635C);
  line-height: 1.5;
}
.pref {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  padding-top: var(--space-3, 12px);
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}
.pref-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3, 12px);
  cursor: pointer;
}
.pref-head { display: flex; flex-direction: column; gap: 2px; }
.pref-label { font-size: var(--text-base, 15px); font-weight: var(--font-semibold, 600); color: var(--ink-primary, #2C2622); }
.pref-desc { font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078); line-height: 1.5; }
.chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2, 8px); }
.chip {
  font: inherit;
  font-size: var(--text-sm, 13px);
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(44, 38, 34, 0.14);
  background: transparent;
  color: var(--ink-secondary, #6B635C);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.chip.active {
  background: var(--accent-belt, #7C6A58);
  border-color: var(--accent-belt, #7C6A58);
  color: #fff;
}
.toggle-switch { flex-shrink: 0; }
.toggle-track {
  width: 42px; height: 24px; border-radius: 12px;
  background: rgba(44, 38, 34, 0.14);
  position: relative;
  transition: background 0.15s ease;
}
.toggle-switch.is-on .toggle-track { background: var(--accent-belt, #7C6A58); }
.toggle-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 20px; height: 20px; border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
}
.toggle-switch.is-on .toggle-thumb { transform: translateX(18px); }
.rest-toggle {
  font: inherit;
  font-size: var(--text-sm, 13px);
  color: var(--ink-tertiary, #8A8078);
  background: none;
  border: 0;
  padding: 0;
  text-align: left;
  cursor: pointer;
}
.rest-toggle:hover { color: var(--ink-secondary, #6B635C); }
.rest-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--text-sm, 13px);
  color: var(--ink-secondary, #6B635C);
}
.sketch-note {
  margin: 0;
  font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078);
  font-style: italic;
}
</style>
