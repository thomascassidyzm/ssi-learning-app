<script setup lang="ts">
/**
 * PlayAsClassIdentity — the SLIM in-nav chip shown in the top bar while a
 * play-as-class session is live. Names the class ("Playing as 6S") so a
 * teacher running back-to-back sessions on a projector or shared device
 * always knows which class is on screen (founder ruling, 2026-07-18), and
 * carries the one-tap End session exit.
 *
 * Slimmed 2026-07-30 (founder: the old large variant "doesn't quite fit in —
 * and makes the topnav banner a bit too big"): the chip now fits the bar's
 * standard control height and sits INSIDE the nav alongside the section tabs,
 * which stay visible during a session — context without takeover. The red
 * fill + live dot keep it unmissable at the smaller size.
 *
 * Rendered by both persistent top bars (SchoolsTopBar, TopNav) on the play
 * routes, so it looks and behaves identically in the schools and tutor shells.
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
  gap: 8px;
  min-width: 0;
  padding: 4px 5px 4px 12px;
  border-radius: 999px;
  /* Belt/red accent = "this is live", the same alarm-colour the app uses for
     the active/red accent. Stands out against the white bar so it reads as
     live context, even at chip size. */
  background: var(--schools-red, #c23a3a);
  color: #fff;
}

/* Pulsing "live" dot — same signal as a recording/on-air light. */
.pac-live {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7);
  animation: pac-pulse 2s ease-out infinite;
}
@keyframes pac-pulse {
  0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.6); }
  70% { box-shadow: 0 0 0 6px rgba(255, 255, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .pac-live { animation: none; }
}

.pac-text {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.pac-kicker {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.85;
  white-space: nowrap;
  flex: none;
}
/* The class name is the chip's primary content: bold, truncating last —
   bar-sized rather than headline-sized (slim ruling, 2026-07-30). */
.pac-class {
  font-size: 14.5px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
/* School demoted to a quiet secondary label. */
.pac-school {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
  flex: 0 1 auto;
}

.pac-exit {
  flex: none;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--schools-red, #c23a3a);
  background: #fff;
  border: none;
  border-radius: 999px;
  padding: 5px 11px;
  min-height: 26px;
  cursor: pointer;
  transition: background 0.15s;
}
.pac-exit:hover { background: #f2ede7; }
.pac-exit:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* Tighter widths (the tabs share the bar now): the demoted school line goes
   first, then the kicker — the class name + exit always survive. */
@media (max-width: 1100px) {
  .pac-school { display: none; }
}
@media (max-width: 480px) {
  .pac { gap: 6px; padding-left: 10px; }
  .pac-kicker { display: none; }
  .pac-class { font-size: 13.5px; }
}
</style>
