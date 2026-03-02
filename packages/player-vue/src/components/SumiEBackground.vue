<script setup lang="ts">
/**
 * Cultural journey background — mist theme only.
 * Shows a language-specific ink/sketch painting as a subtle background layer,
 * plus ambient particles that match the cultural atmosphere:
 *   jpn = cherry blossom petals drifting down
 *   zho = mist wisps drifting horizontally
 *   ita = warm golden dust motes floating upward
 * Falls back to Japanese style for unmapped languages.
 */
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  lang?: string
}>(), {
  lang: 'jpn',
})

const JOURNEY_MAP: Record<string, string> = {
  jpn: '/design/journey-jpn.webp',
  zho: '/design/journey-cmn.webp',
  cmn: '/design/journey-cmn.webp',
  ita: '/design/journey-ita.webp',
}

const PARTICLE_TYPES: Record<string, string> = {
  jpn: 'petals',
  zho: 'mist',
  cmn: 'mist',
  ita: 'motes',
}

const DEFAULT_JOURNEY = '/design/journey-jpn.webp'

const imageSrc = computed(() => JOURNEY_MAP[props.lang] || DEFAULT_JOURNEY)
const particleType = computed(() => PARTICLE_TYPES[props.lang] || 'petals')

// 10 particles with pre-seeded random-ish positions and timing
const particles = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  style: {
    '--p-left': `${7 + (i * 37 + 13) % 86}%`,
    '--p-delay': `${(i * 3.7) % 20}s`,
    '--p-duration': `${18 + (i * 7) % 16}s`,
    '--p-size': `${6 + (i * 3) % 7}px`,
  },
}))
</script>

<template>
  <div class="journey-bg" aria-hidden="true">
    <img
      :src="imageSrc"
      alt=""
      class="journey-painting"
      loading="eager"
      draggable="false"
    >
    <!-- Ambient particles -->
    <div class="particles" :class="`particles--${particleType}`">
      <span
        v-for="p in particles"
        :key="p.id"
        class="particle"
        :style="p.style"
      />
    </div>
  </div>
</template>

<style scoped>
.journey-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

.journey-painting {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  opacity: 0.18;
  mix-blend-mode: multiply;
}

@media (min-aspect-ratio: 3/4) {
  .journey-painting {
    object-fit: contain;
  }
}

/* ── Particle base ── */
.particles {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.particle {
  position: absolute;
  left: var(--p-left, 50%);
  width: var(--p-size, 4px);
  height: var(--p-size, 4px);
  border-radius: 50%;
  opacity: 0;
  will-change: transform, opacity;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
  animation-delay: var(--p-delay, 0s);
  animation-duration: var(--p-duration, 24s);
}

/* ── Cherry blossom petals (Japanese) ── */
.particles--petals .particle {
  background: radial-gradient(circle, rgba(219, 140, 160, 0.9), rgba(219, 140, 160, 0.3));
  border-radius: 50% 0 50% 0;
  animation-name: petal-fall;
}

@keyframes petal-fall {
  0% {
    transform: translate(0, -5vh) rotate(0deg);
    opacity: 0;
  }
  8% { opacity: 0.8; }
  85% { opacity: 0.7; }
  100% {
    transform: translate(40px, 105vh) rotate(540deg);
    opacity: 0;
  }
}

/* ── Mist wisps (Chinese) ── */
.particles--mist .particle {
  background: radial-gradient(ellipse, rgba(120, 120, 130, 0.6), transparent);
  width: calc(var(--p-size, 4px) * 12);
  height: calc(var(--p-size, 4px) * 3);
  border-radius: 50%;
  animation-name: mist-drift;
}

@keyframes mist-drift {
  0% {
    transform: translateX(-15vw) scaleX(0.8);
    opacity: 0;
  }
  15% { opacity: 0.5; }
  75% { opacity: 0.4; }
  100% {
    transform: translateX(110vw) scaleX(1.2);
    opacity: 0;
  }
}

/* ── Golden dust motes (Italian) ── */
.particles--motes .particle {
  background: radial-gradient(circle, rgba(180, 150, 90, 0.9), rgba(180, 150, 90, 0.3));
  animation-name: mote-float;
}

@keyframes mote-float {
  0% {
    transform: translate(0, 5vh) scale(0.8);
    opacity: 0;
  }
  10% { opacity: 0.7; }
  50% {
    transform: translate(15px, -20vh) scale(1);
    opacity: 0.8;
  }
  90% { opacity: 0.5; }
  100% {
    transform: translate(-10px, -40vh) scale(0.6);
    opacity: 0;
  }
}

/* Reduce particles for reduced-motion preference */
@media (prefers-reduced-motion: reduce) {
  .particle {
    animation: none;
    opacity: 0;
  }
}
</style>
