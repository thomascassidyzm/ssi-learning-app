import { ref, watch } from 'vue'

export type SchoolsDensity = 'compact' | 'detailed'

const STORAGE_KEY = 'ssi-schools-density'

function readInitial(): SchoolsDensity {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'detailed' ? 'detailed' : 'compact'
  } catch {
    return 'compact'
  }
}

const density = ref<SchoolsDensity>(readInitial())

watch(density, (v) => {
  try { localStorage.setItem(STORAGE_KEY, v) } catch {}
})

export function useSchoolsDensity() {
  return { density }
}
