<script setup lang="ts">
/**
 * ActingAsBanner — the unmissable strip shown whenever an ssi_admin is
 * viewing the app as somebody else. Rendered globally from App.vue, so it is
 * on EVERY page for as long as view-as is on, and its Exit is one tap back to
 * the admin's own identity.
 *
 * A silent impersonation mode is worse than none: this is deliberately loud
 * (amber, fixed, above everything) and names the persona and their scope.
 */
import { computed } from 'vue'
import { useUserRole, roleLabel } from '@/composables/useUserRole'
import { useActAs } from '@/composables/useActAs'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'

const { actingAs, isActingAs } = useUserRole()
const { exitActAs } = useActAs()
const { currentUser } = useSchoolContext()

const label = computed(() => {
  const p = actingAs.value
  if (!p) return ''
  const school = currentUser.value?.school_name
  // Role-only view-as has no person to name — the role IS the identity.
  const who = p.userId ? p.name : `any ${roleLabel(p.role).toLowerCase()}`
  const parts = [p.userId ? roleLabel(p.role) : null, school].filter(Boolean)
  return parts.length ? `${who} · ${parts.join(' · ')}` : who
})
</script>

<template>
  <div v-if="isActingAs" class="acting-as-banner" role="status" aria-live="polite">
    <span class="aab-eye" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </span>
    <span class="aab-text">Viewing as <strong>{{ label }}</strong> — read only</span>
    <button type="button" class="aab-exit" data-testid="view-as-exit" @click="exitActAs">Exit</button>
  </div>
</template>

<style scoped>
.acting-as-banner {
  position: fixed;
  /* Top, so it is the first thing seen on every page. Safe-area inset keeps
     it clear of the iOS status bar / notch (standing rule). */
  top: calc(env(safe-area-inset-top, 0px) + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px 7px 13px;
  border-radius: 999px;
  background: #b45309;
  color: #fff;
  font-family: 'Open Sans', 'Trebuchet MS', system-ui, Arial, sans-serif;
  font-size: 13px;
  line-height: 1;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
  max-width: min(calc(100vw - 24px), 560px);
}
.aab-eye {
  display: inline-flex;
  opacity: 0.9;
}
.aab-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aab-text strong {
  font-weight: 700;
}
.aab-exit {
  font: inherit;
  font-weight: 700;
  color: #b45309;
  background: #fff;
  border: none;
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
  transition: background 0.15s;
  flex: none;
}
.aab-exit:hover {
  background: #ffedd5;
}
</style>
