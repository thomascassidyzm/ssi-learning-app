<script setup lang="ts">
/**
 * ClimbingBandFigure — "Speaking first, deep listening later".
 *
 * One climbing band split in two along its length. Speaking is the wide half at
 * the start and the narrow half later; deep listening does the opposite. It is
 * the same climb as the mountain in Part 1, seen as a band.
 *
 * What it fixes: read as prose, "speaking first, listening later" sounds like
 * two phases with a switch between them, which is not what the app does. The
 * band has no switch in it — the proportions change and nothing stops.
 *
 * The number stays OFF the drawing. "It turns a corner" is the label; "the
 * first thirty hours or so" stays in the body text underneath, subordinate,
 * exactly where the founder ruling puts it. The proportions are drawn, not
 * measured — they are the sentence rendered as a shape, never a ratio.
 */
</script>

<template>
  <figure class="xf">
    <svg
      class="xf-svg"
      viewBox="0 0 330 176"
      fill="none"
      role="img"
      aria-label="One climbing band split in two: speaking is the wide half at the start and the narrow half later; deep listening does the opposite. Neither ever stops."
    >
      <defs>
        <pattern id="xf-band-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
          <path d="M0 0 L0 6" stroke="currentColor" opacity="0.30" stroke-width="1.1" />
        </pattern>
      </defs>
      <g transform="translate(0,26)">
        <!-- Speaking: the upper half of the climbing band. -->
        <path d="M13.8 89.0 L17.8 88.7 L22.5 88.3 L27.3 87.7 L32.1 87.1 L37.0 86.4 L41.9 85.7 L46.8 84.9 L51.7 84.1 L56.6 83.2 L61.6 82.3 L66.5 81.4 L71.5 80.4 L76.4 79.4 L81.4 78.4 L86.4 77.3 L91.3 76.3 L96.3 75.2 L101.3 74.0 L106.2 72.9 L111.2 71.7 L116.2 70.5 L121.2 69.3 L126.1 68.1 L131.1 66.8 L136.1 65.5 L141.1 64.3 L146.1 63.0 L151.1 61.6 L156.1 60.3 L161.0 58.9 L166.0 57.6 L171.0 56.2 L176.0 54.8 L181.0 53.3 L186.0 51.9 L191.0 50.5 L196.0 49.0 L201.0 47.5 L206.0 46.0 L211.0 44.5 L216.0 43.0 L221.0 41.5 L226.0 39.9 L231.0 38.4 L236.0 36.8 L241.0 35.2 L246.0 33.6 L251.0 32.0 L256.0 30.4 L261.0 28.8 L266.0 27.1 L271.0 25.5 L276.0 23.8 L281.0 22.1 L286.0 20.4 L291.0 18.7 L296.0 17.0 L301.0 15.3 L306.1 13.6 L313.4 11.2 L314.5 17.1 L308.1 19.5 L303.2 21.5 L298.3 23.6 L293.4 25.6 L288.4 27.5 L283.5 29.5 L278.6 31.5 L273.7 33.4 L268.7 35.4 L263.8 37.3 L258.9 39.2 L253.9 41.1 L249.0 43.0 L244.1 44.9 L239.1 46.8 L234.2 48.7 L229.3 50.5 L224.3 52.4 L219.4 54.2 L214.5 56.0 L209.5 57.8 L204.6 59.6 L199.6 61.4 L194.7 63.1 L189.8 64.9 L184.8 66.6 L179.9 68.3 L174.9 70.0 L170.0 71.7 L165.0 73.4 L160.0 75.1 L155.1 76.7 L150.1 78.3 L145.2 79.9 L140.2 81.5 L135.2 83.1 L130.3 84.7 L125.3 86.2 L120.3 87.7 L115.4 89.2 L110.4 90.7 L105.4 92.2 L100.4 93.6 L95.4 95.0 L90.4 96.4 L85.5 97.8 L80.5 99.1 L75.5 100.4 L70.4 101.7 L65.4 103.0 L60.4 104.2 L55.4 105.4 L50.4 106.5 L45.3 107.6 L40.3 108.7 L35.2 109.7 L30.1 110.7 L25.0 111.6 L19.8 112.4 L14.1 113.0 Z" fill="currentColor" fill-opacity="0.34" />
        <!-- Deep listening: the lower half, hatched over a pale wash. -->
        <path d="M14.1 113.0 L19.8 112.4 L25.0 111.6 L30.1 110.7 L35.2 109.7 L40.3 108.7 L45.3 107.6 L50.4 106.5 L55.4 105.4 L60.4 104.2 L65.4 103.0 L70.4 101.7 L75.5 100.4 L80.5 99.1 L85.5 97.8 L90.4 96.4 L95.4 95.0 L100.4 93.6 L105.4 92.2 L110.4 90.7 L115.4 89.2 L120.3 87.7 L125.3 86.2 L130.3 84.7 L135.2 83.1 L140.2 81.5 L145.2 79.9 L150.1 78.3 L155.1 76.7 L160.0 75.1 L165.0 73.4 L170.0 71.7 L174.9 70.0 L179.9 68.3 L184.8 66.6 L189.8 64.9 L194.7 63.1 L199.6 61.4 L204.6 59.6 L209.5 57.8 L214.5 56.0 L219.4 54.2 L224.3 52.4 L229.3 50.5 L234.2 48.7 L239.1 46.8 L244.1 44.9 L249.0 43.0 L253.9 41.1 L258.9 39.2 L263.8 37.3 L268.7 35.4 L273.7 33.4 L278.6 31.5 L283.5 29.5 L288.4 27.5 L293.4 25.6 L298.3 23.6 L303.2 21.5 L308.1 19.5 L314.5 17.1 L318.6 40.8 L315.9 41.9 L310.8 43.7 L305.8 45.4 L300.7 47.1 L295.6 48.9 L290.6 50.6 L285.5 52.3 L280.5 53.9 L275.4 55.6 L270.3 57.3 L265.3 58.9 L260.2 60.6 L255.1 62.2 L250.1 63.8 L245.0 65.4 L239.9 67.0 L234.9 68.6 L229.8 70.1 L224.7 71.7 L219.7 73.2 L214.6 74.8 L209.5 76.3 L204.5 77.8 L199.4 79.3 L194.3 80.7 L189.3 82.2 L184.2 83.6 L179.1 85.1 L174.0 86.5 L169.0 87.9 L163.9 89.3 L158.8 90.6 L153.7 92.0 L148.6 93.3 L143.6 94.6 L138.5 95.9 L133.4 97.2 L128.3 98.4 L123.2 99.7 L118.1 100.9 L113.0 102.1 L107.9 103.3 L102.8 104.4 L97.7 105.6 L92.6 106.7 L87.5 107.7 L82.4 108.8 L77.3 109.8 L72.2 110.8 L67.1 111.8 L62.0 112.7 L56.8 113.6 L51.7 114.5 L46.5 115.3 L41.3 116.1 L36.1 116.8 L30.9 117.5 L25.6 118.1 L20.3 118.6 L14.2 119.0 Z" fill="currentColor" fill-opacity="0.10" />
        <path d="M14.1 113.0 L19.8 112.4 L25.0 111.6 L30.1 110.7 L35.2 109.7 L40.3 108.7 L45.3 107.6 L50.4 106.5 L55.4 105.4 L60.4 104.2 L65.4 103.0 L70.4 101.7 L75.5 100.4 L80.5 99.1 L85.5 97.8 L90.4 96.4 L95.4 95.0 L100.4 93.6 L105.4 92.2 L110.4 90.7 L115.4 89.2 L120.3 87.7 L125.3 86.2 L130.3 84.7 L135.2 83.1 L140.2 81.5 L145.2 79.9 L150.1 78.3 L155.1 76.7 L160.0 75.1 L165.0 73.4 L170.0 71.7 L174.9 70.0 L179.9 68.3 L184.8 66.6 L189.8 64.9 L194.7 63.1 L199.6 61.4 L204.6 59.6 L209.5 57.8 L214.5 56.0 L219.4 54.2 L224.3 52.4 L229.3 50.5 L234.2 48.7 L239.1 46.8 L244.1 44.9 L249.0 43.0 L253.9 41.1 L258.9 39.2 L263.8 37.3 L268.7 35.4 L273.7 33.4 L278.6 31.5 L283.5 29.5 L288.4 27.5 L293.4 25.6 L298.3 23.6 L303.2 21.5 L308.1 19.5 L314.5 17.1 L318.6 40.8 L315.9 41.9 L310.8 43.7 L305.8 45.4 L300.7 47.1 L295.6 48.9 L290.6 50.6 L285.5 52.3 L280.5 53.9 L275.4 55.6 L270.3 57.3 L265.3 58.9 L260.2 60.6 L255.1 62.2 L250.1 63.8 L245.0 65.4 L239.9 67.0 L234.9 68.6 L229.8 70.1 L224.7 71.7 L219.7 73.2 L214.6 74.8 L209.5 76.3 L204.5 77.8 L199.4 79.3 L194.3 80.7 L189.3 82.2 L184.2 83.6 L179.1 85.1 L174.0 86.5 L169.0 87.9 L163.9 89.3 L158.8 90.6 L153.7 92.0 L148.6 93.3 L143.6 94.6 L138.5 95.9 L133.4 97.2 L128.3 98.4 L123.2 99.7 L118.1 100.9 L113.0 102.1 L107.9 103.3 L102.8 104.4 L97.7 105.6 L92.6 106.7 L87.5 107.7 L82.4 108.8 L77.3 109.8 L72.2 110.8 L67.1 111.8 L62.0 112.7 L56.8 113.6 L51.7 114.5 L46.5 115.3 L41.3 116.1 L36.1 116.8 L30.9 117.5 L25.6 118.1 L20.3 118.6 L14.2 119.0 Z" fill="url(#xf-band-hatch)" />
      </g>
      <path d="M165.0 69.4 L165.0 87.4" stroke="currentColor" opacity="0.34" stroke-width="1.2" stroke-dasharray="2 4" stroke-linecap="round" />
      <text class="xf-ink2" x="165.0" y="63.4" text-anchor="middle" font-size="10.5">it turns a corner</text>
      <rect x="14" y="10" width="9" height="9" rx="2" fill="currentColor" fill-opacity="0.34" />
      <text class="xf-ink1" x="29" y="19" font-size="11.5" font-weight="600">speaking</text>
      <text class="xf-ink2" x="29" y="33" font-size="10.5">builds the language you own</text>
      <rect x="180" y="152" width="9" height="9" rx="2" fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-opacity="0.22" stroke-width=".8" />
      <rect x="180" y="152" width="9" height="9" rx="2" fill="url(#xf-band-hatch)" />
      <text class="xf-ink1" x="195" y="161" font-size="11.5" font-weight="600">deep listening</text>
      <text class="xf-ink2" x="195" y="174" font-size="10.5">carries you furthest</text>
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
