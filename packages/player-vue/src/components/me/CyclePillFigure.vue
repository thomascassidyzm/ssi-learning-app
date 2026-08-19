<script setup lang="ts">
/**
 * CyclePillFigure — a still portrait of the player's phase pill, for the
 * explainer to point at.
 *
 * The learner meets this exact shape on the player screen: one pill, four
 * segments, headphones then the gap then two voices, with the gap segment
 * filling red as their turn runs down. Drawing the same object here means the
 * picture in the explainer and the pill on the player teach each other.
 *
 * Deliberately a DUPLICATE of the player's markup, not a shared component.
 * The live pill in LearningPlayer.vue is load-bearing interactive code with a
 * long bug history recorded in its CSS comments — sticky iOS hover, the
 * invisible-countdown track, the pointer-events pass-through. Refactoring it
 * out to share fifty lines of static shape would put all of that at risk for
 * no gain. This copy is static, inert and cheap to keep in step.
 *
 * Inert by construction: divs, never buttons; no handlers; the whole figure is
 * aria-hidden behind a single sentence of alt text in the learner's own words.
 * Nothing animates, so prefers-reduced-motion needs no special case.
 */
</script>

<template>
  <figure class="cpf">
    <div class="cpf-pill" aria-hidden="true">
      <div class="cpf-seg cpf-seg--prompt">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
          <rect x="2" y="13" width="5" height="8" rx="2" />
          <rect x="17" y="13" width="5" height="8" rx="2" />
        </svg>
      </div>
      <div class="cpf-seg cpf-seg--pause">
        <span class="cpf-fill"></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11v1a7 7 0 0 0 14 0v-1" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="8" y1="22" x2="16" y2="22" />
        </svg>
      </div>
      <div class="cpf-seg cpf-seg--voice1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 21v-1.5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5V21" />
        </svg>
        <span class="cpf-num">1</span>
      </div>
      <div class="cpf-seg cpf-seg--voice2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 21v-1.5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5V21" />
        </svg>
        <span class="cpf-num">2</span>
      </div>
    </div>
    <div class="cpf-labels" aria-hidden="true">
      <span class="cpf-label cpf-label--prompt">you hear it</span>
      <span class="cpf-label cpf-label--pause">your turn</span>
      <span class="cpf-label cpf-label--voices">then twice, properly</span>
    </div>
    <figcaption class="cpf-caption">
      One go, as it looks on the player screen: you hear the phrase, then the
      wide middle stretch is your turn to say it out loud, then two different
      voices say it properly.
    </figcaption>
  </figure>
</template>

<style scoped>
.cpf {
  margin: 4px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Same box as the player's .phase-strip: white, stadium, hairline border and
   the same two-layer shadow, so it reads as the same object. */
.cpf-pill {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 36px;
  background: #ffffff;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 18px;
  box-shadow:
    0 2px 4px rgba(44, 38, 34, 0.10),
    0 6px 16px rgba(44, 38, 34, 0.06);
  overflow: hidden;
}

/* 20 / 40 / 20 / 20 — the gap is deliberately the widest thing in the pill,
   which is the whole point the prose is making. */
.cpf-seg {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 0 0 20%;
  min-width: 0;
  color: rgba(0, 0, 0, 0.55);
}
.cpf-seg--pause {
  flex: 0 0 40%;
  background: var(--ssi-red-soft, rgba(194, 58, 58, 0.15));
  color: rgba(0, 0, 0, 0.7);
}

.cpf-seg + .cpf-seg::before {
  content: '';
  position: absolute;
  left: 0;
  top: 25%;
  bottom: 25%;
  width: 1px;
  background: rgba(0, 0, 0, 0.12);
  z-index: 2;
}
/* The gap segment owns its own soft track, so the divider into it would sit on
   a colour change and read as a wall rather than a tick. */
.cpf-seg--pause::before,
.cpf-seg--voice1::before {
  display: none;
}

.cpf-seg svg {
  width: 18px;
  height: 18px;
  display: block;
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
}
.cpf-num {
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
}

/* Frozen part-way across: the learner's turn, running. */
.cpf-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 45%;
  background: var(--ssi-red, #c23a3a);
  z-index: 0;
}

.cpf-labels {
  display: flex;
  width: 100%;
  font-size: 10px;
  line-height: 1.3;
  color: var(--ink-tertiary, #8A8078);
  text-align: center;
}
/* Each label stays on one line: a 20%-wide cell will wrap "you hear it" onto a
   lonely "it" otherwise. Overflow is centred, so a long label leans equally
   into both neighbours' whitespace rather than colliding with one. */
.cpf-label {
  min-width: 0;
  padding: 0 2px;
  white-space: nowrap;
}
.cpf-label--prompt { flex: 0 0 20%; }
.cpf-label--pause { flex: 0 0 40%; }
.cpf-label--voices { flex: 0 0 40%; }

/* The caption is the figure's text alternative, and reads as prose either way
   — screen readers get the four stages in the learner's own words, and sighted
   readers get a line worth having. */
.cpf-caption {
  margin: 2px 0 0;
  font-size: var(--text-xs, 12px);
  line-height: 1.55;
  color: var(--ink-tertiary, #8A8078);
}
</style>
