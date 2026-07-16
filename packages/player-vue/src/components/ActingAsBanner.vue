<script setup lang="ts">
/**
 * ActingAsBanner — a persistent bar shown whenever an ssi_admin is acting as
 * a persona. Makes the borrowed identity obvious and gives a one-tap exit
 * back to the admin's own view. Rendered globally from App.vue.
 */
import { computed } from 'vue'
import { useUserRole, roleLabel } from '@/composables/useUserRole'
import { useActAs } from '@/composables/useActAs'

const { actingAs, isActingAs } = useUserRole()
const { exitActAs } = useActAs()

const label = computed(() =>
  actingAs.value ? `${actingAs.value.name} · ${roleLabel(actingAs.value.role)}` : '',
)
</script>

<template>
  <div v-if="isActingAs" class="acting-as-banner">
    <span class="aab-eye" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </span>
    <span class="aab-text">Viewing as <strong>{{ label }}</strong></span>
    <button type="button" class="aab-exit" @click="exitActAs">Exit</button>
  </div>
</template>

<style scoped>
.acting-as-banner {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 8px 14px;
  border-radius: 999px;
  background: #2c2622;
  color: #fff;
  font-size: 13px;
  line-height: 1;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
  max-width: calc(100vw - 24px);
}
.aab-eye {
  display: inline-flex;
  opacity: 0.85;
}
.aab-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.aab-text strong {
  font-weight: 600;
}
.aab-exit {
  font: inherit;
  font-weight: 600;
  color: #2c2622;
  background: #fff;
  border: none;
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.aab-exit:hover {
  background: #f0ece6;
}
</style>
