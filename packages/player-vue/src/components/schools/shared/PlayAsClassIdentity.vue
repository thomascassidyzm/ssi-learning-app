<script setup lang="ts">
/**
 * PlayAsClassIdentity — the DOMINANT identity element shown in the top bar while
 * a play-as-class session is live. Names the class big, bold and unmissable
 * ("Playing as 6S") so a teacher running back-to-back sessions on a projector or
 * shared device always knows which class is on screen (founder ruling,
 * 2026-07-18). School is demoted to a secondary line; an obvious Exit stays put.
 *
 * Rendered by both persistent top bars (SchoolsTopBar, TopNav) on the play
 * routes, so it looks and behaves identically in the schools and tutor shells.
 * Visual language matches the View-as banner (ActingAsBanner): a live-status pill
 * with a one-tap exit.
 */
defineProps<{
  className: string
  schoolName?: string
}>()

defineEmits<{ exit: [] }>()
</script>

<template>
  <div class="pac" role="status" aria-live="polite" :aria-label="`Playing as ${className}`">
    <span class="pac-live" aria-hidden="true"></span>
    <span class="pac-text">
      <span class="pac-kicker">Playing&nbsp;as</span>
      <strong class="pac-class">{{ className }}</strong>
      <span v-if="schoolName" class="pac-school" :title="schoolName">{{ schoolName }}</span>
    </span>
    <button type="button" class="pac-exit" @click="$emit('exit')">End session</button>
  </div>
</template>

<style scoped>
.pac {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 6px 8px 6px 16px;
  border-radius: 999px;
  /* Belt/red accent = "this is live", the same alarm-colour the app uses for
     the active/red accent. Stands out against the white bar so it reads as the
     dominant element, not a label. */
  background: var(--schools-red, #c23a3a);
  color: #fff;
  box-shadow: 0 2px 8px rgba(194, 58, 58, 0.28);
}

/* Pulsing "live" dot — same signal as a recording/on-air light. */
.pac-live {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7);
  animation: pac-pulse 2s ease-out infinite;
}
@keyframes pac-pulse {
  0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.6); }
  70% { box-shadow: 0 0 0 7px rgba(255, 255, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .pac-live { animation: none; }
}

.pac-text {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.pac-kicker {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.85;
  white-space: nowrap;
  flex: none;
}
/* The class name is the primary identity: large, bold, truncating last. */
.pac-class {
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
/* School demoted to a quiet secondary line. */
.pac-school {
  font-size: 12px;
  font-weight: 500;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
  flex: 0 1 auto;
}

.pac-exit {
  flex: none;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--schools-red, #c23a3a);
  background: #fff;
  border: none;
  border-radius: 999px;
  padding: 7px 14px;
  min-height: 34px;
  cursor: pointer;
  transition: background 0.15s;
}
.pac-exit:hover { background: #f2ede7; }
.pac-exit:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* Phone widths: keep the class name + exit; drop the demoted school line and
   tighten so both fit a narrow bar. */
@media (max-width: 480px) {
  .pac { gap: 8px; padding-left: 12px; }
  .pac-school { display: none; }
  .pac-class { font-size: 17px; }
  .pac-kicker { display: none; }
}
</style>
