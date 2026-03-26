import { ref } from 'vue'

/** Global flag: when true, schools composables skip Supabase queries */
export const isDemoMode = ref(false)
