<script setup lang="ts">
/**
 * ListeningStretchFigure — "What the listening stretches ask of you".
 *
 * The speaking half of the line is beats and gaps — the learner's turns. The
 * listening half is one unbroken stroke with no gaps in it at all, and then the
 * speaking resumes.
 *
 * The absence of gaps is the argument. "Nothing is asked of you here" is a
 * claim a learner will not believe from a sentence, because everything else in
 * the app has asked something of them; a line with nowhere to speak is proof.
 */
</script>

<template>
  <figure class="xf">
    <svg
      class="xf-svg"
      viewBox="0 0 330 96"
      fill="none"
      role="img"
      aria-label="The speaking rhythm of beats and gaps gives way to one long unbroken line of listening, with no gaps in it, and then the speaking resumes."
    >
      <!-- Speaking: beat, gap, beat, gap. The dotted stretches are the turns. -->
      <g stroke-linecap="round">
        <path d="M8 44 L 26 44" stroke="currentColor" opacity="0.55" stroke-width="2.4" />
        <path d="M32 44 L 56 44" stroke="currentColor" opacity="0.18" stroke-width="1.4" stroke-dasharray="2 5" />
        <path d="M62 44 L 80 44" stroke="currentColor" opacity="0.55" stroke-width="2.4" />
        <path d="M86 44 L 110 44" stroke="currentColor" opacity="0.18" stroke-width="1.4" stroke-dasharray="2 5" />
      </g>
      <!-- The handover. -->
      <path d="M116 44 C 126 44, 128 44, 136 44" stroke="currentColor" opacity="0.30" stroke-width="1.4" stroke-linecap="round" />
      <!-- Listening: one unbroken stroke, no gaps at all. -->
      <path d="M140 44 C 190 40, 250 48, 300 43" stroke="currentColor" opacity="0.50" stroke-width="3.2" stroke-linecap="round" />
      <!-- And back. -->
      <path d="M306 44 L 322 44" stroke="currentColor" opacity="0.55" stroke-width="2.4" stroke-linecap="round" />
      <path d="M132 34 L132 54" stroke="currentColor" opacity="0.22" stroke-width="1.2" stroke-linecap="round" />
      <path d="M304 34 L304 54" stroke="currentColor" opacity="0.22" stroke-width="1.2" stroke-linecap="round" />
      <text class="xf-ink2" x="59" y="22" text-anchor="middle" font-size="10.5">your turns</text>
      <text class="xf-ink1" x="218" y="22" text-anchor="middle" font-size="11" font-weight="600">no gaps, nothing asked of you</text>
      <text class="xf-ink2" x="165" y="72" text-anchor="middle" font-size="10.5">it simply plays, then the speaking returns</text>
    </svg>
  </figure>
</template>

<style scoped>
.xf {
  margin: 2px 0 0;
  display: flex;
  flex-direction: column;
  color: var(--ink-primary, #2c2622);
}
.xf-svg { width: 100%; height: auto; display: block; }
.xf-svg text { font-family: inherit; }
.xf-ink1 { fill: var(--ink-primary, #2c2622); }
.xf-ink2 { fill: var(--ink-secondary, #6b635c); }
</style>
