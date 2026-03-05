import { ref, computed, watch, type Ref } from 'vue'

export type ScriptMode = 'roman' | 'native'

const STORAGE_KEY_PREFIX = 'ssi_script_mode_'

/**
 * Toggle between romanized and native script display for target language.
 * Preference is stored per-course in localStorage.
 */
export function useScriptMode(courseCode: Ref<string>) {
  const scriptMode = ref<ScriptMode>('roman')

  // Load saved preference when course changes
  watch(courseCode, (code) => {
    if (!code) return
    const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${code}`)
    scriptMode.value = saved === 'native' ? 'native' : 'roman'
  }, { immediate: true })

  // Persist on change
  watch(scriptMode, (mode) => {
    if (!courseCode.value) return
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${courseCode.value}`, mode)
  })

  const isNativeScript = computed(() => scriptMode.value === 'native')

  const toggleScriptMode = () => {
    scriptMode.value = scriptMode.value === 'roman' ? 'native' : 'roman'
  }

  return { scriptMode, isNativeScript, toggleScriptMode }
}
