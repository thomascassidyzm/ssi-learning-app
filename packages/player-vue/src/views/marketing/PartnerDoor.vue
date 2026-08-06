<script setup lang="ts">
/**
 * PartnerDoor — a parameterised landing page for one partner's network.
 *
 * Route-driven: `/znotes` mounts this with partner="znotes"; a second partner
 * is one entry in views/marketing/partners.ts plus one route line, no new
 * component. Deliberately UNLINKED from every nav — shareable by URL, not
 * discoverable — and it stamps <meta name="robots" content="noindex"> while
 * mounted so a crawler that stumbles on the link doesn't index it.
 *
 * It sells the LIVE tutor model only. No affiliate/introducer offer appears
 * here (that lane is undecided, founder exploration 2026-08-03), and the single
 * CTA is the existing /tutors signup door — this page owns no auth, no
 * checkout, no state.
 */
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { partnerDoorCopy } from './partners'

const props = defineProps<{ partner: string }>()

const copy = computed(() => partnerDoorCopy(props.partner))

// Unlinked is the flag, noindex is the belt-and-braces. Removed on unmount so
// the tag never leaks onto the rest of the SPA.
let robotsTag: HTMLMetaElement | null = null
onMounted(() => {
  robotsTag = document.createElement('meta')
  robotsTag.name = 'robots'
  robotsTag.content = 'noindex, nofollow'
  document.head.appendChild(robotsTag)
})
onBeforeUnmount(() => {
  if (robotsTag) {
    robotsTag.remove()
    robotsTag = null
  }
})
</script>

<template>
  <div v-if="copy" class="pd">
    <!-- HERO — kicker, one hard number, the declarative line -->
    <header class="pd-hero">
      <img class="pd-wordmark" src="/ssi-web-logo.svg" alt="SaySomethingin" />
      <p class="pd-kicker">{{ copy.kicker }}</p>
      <h1 class="pd-headline">{{ copy.headline }}</h1>

      <div class="pd-proof" role="img" :aria-label="copy.proof.label">
        <span class="pd-proof-eyebrow" aria-hidden="true">{{ copy.proof.eyebrow }}</span>
        <span class="pd-proof-stat" aria-hidden="true">
          <span class="pd-proof-num">{{ copy.proof.num }}</span>
          <span class="pd-proof-words">
            <span class="pd-proof-head">{{ copy.proof.headline }}</span>
            <span class="pd-proof-line">{{ copy.proof.line }}</span>
          </span>
        </span>
      </div>

      <p class="pd-stance">{{ copy.stance }}</p>
    </header>

    <!-- THE DEAL — three numbers, no adjectives -->
    <section class="pd-section">
      <h2 class="pd-h2">The deal</h2>
      <ul class="pd-deal">
        <li v-for="d in copy.deal" :key="d.label" class="pd-deal-row">
          <span class="pd-deal-label">{{ d.label }}</span>
          <span class="pd-deal-value">{{ d.value }}</span>
          <span class="pd-deal-note">{{ d.note }}</span>
        </li>
      </ul>
      <p class="pd-example">{{ copy.example }}</p>
    </section>

    <!-- WHAT YOU TEACH -->
    <section class="pd-section">
      <h2 class="pd-h2">{{ copy.teach.heading }}</h2>
      <p class="pd-body">{{ copy.teach.body }}</p>
      <p class="pd-body">{{ copy.hook }}</p>
      <ul class="pd-langs">
        <li v-for="l in copy.teach.languages" :key="l" class="pd-lang">{{ l }}</li>
      </ul>
    </section>

    <!-- HOW IT RUNS -->
    <section class="pd-section">
      <h2 class="pd-h2">How it runs</h2>
      <ol class="pd-steps">
        <li v-for="(s, i) in copy.steps" :key="s.title" class="pd-step">
          <span class="pd-step-num" aria-hidden="true">{{ i + 1 }}</span>
          <span class="pd-step-body">
            <span class="pd-step-title">{{ s.title }}</span>
            <span class="pd-step-text">{{ s.body }}</span>
          </span>
        </li>
      </ol>
    </section>

    <!-- PRACTICALITIES -->
    <section class="pd-section">
      <h2 class="pd-h2">Practicalities</h2>
      <ul class="pd-practical">
        <li v-for="p in copy.practicalities" :key="p">{{ p }}</li>
      </ul>
      <!-- Why there are no testimonials on this page — said, not omitted. -->
      <p class="pd-honesty">{{ copy.honesty }}</p>
    </section>

    <!-- CTA -->
    <footer class="pd-cta">
      <a class="pd-cta-btn" :href="copy.cta.href">{{ copy.cta.label }}</a>
      <p class="pd-cta-note">{{ copy.cta.note }}</p>
    </footer>
  </div>

  <div v-else class="pd pd-missing">
    <p>This page isn’t available.</p>
  </div>
</template>

<style scoped>
/* Mist: warm-grey canvas, white elevated surfaces, one restrained accent. */
.pd {
  min-height: 100vh;
  background: var(--bg-primary, #e8e3dd);
  color: var(--text-primary, #262421);
  font-family: var(--font-body);
  padding: max(2rem, env(safe-area-inset-top, 0px)) max(1.25rem, env(safe-area-inset-right, 0px))
    calc(3rem + env(safe-area-inset-bottom, 0px)) max(1.25rem, env(safe-area-inset-left, 0px));
}

.pd-hero,
.pd-section,
.pd-cta {
  max-width: 44rem;
  margin: 0 auto;
}

.pd-wordmark {
  height: 26px;
  width: auto;
  opacity: 0.85;
  margin-bottom: 2.5rem;
}

.pd-kicker {
  margin: 0 0 0.5rem;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent, #c23a3a);
}

.pd-headline {
  margin: 0 0 2rem;
  font-size: clamp(1.75rem, 5vw, 2.5rem);
  line-height: var(--leading-tight, 1.25);
  font-weight: var(--font-semibold);
  letter-spacing: var(--tracking-tight, -0.025em);
}

/* The one hard number, as an editorial moment — same shape as the signup doors. */
.pd-proof {
  border-left: 3px solid var(--accent, #c23a3a);
  padding: 0.25rem 0 0.25rem 1.25rem;
  margin: 0 0 2rem;
}
.pd-proof-eyebrow {
  display: block;
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary, #6b6660);
  margin-bottom: 0.5rem;
}
.pd-proof-stat {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.pd-proof-num {
  font-size: clamp(2.25rem, 8vw, 3rem);
  font-weight: var(--font-bold);
  line-height: 1;
}
.pd-proof-head {
  display: block;
  font-weight: var(--font-semibold);
}
.pd-proof-line {
  display: block;
  font-size: var(--text-sm);
  color: var(--text-secondary, #6b6660);
}

.pd-stance {
  margin: 0;
  font-size: var(--text-lg);
  line-height: var(--leading-relaxed, 1.625);
}

.pd-section {
  margin-top: 3rem;
}

.pd-h2 {
  margin: 0 0 1rem;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary, #6b6660);
}

.pd-body {
  margin: 0 0 1.25rem;
  line-height: var(--leading-relaxed, 1.625);
}

/* Deal — three rows, the number carrying the weight. */
.pd-deal {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--bg-elevated, #ffffff);
  border-radius: 14px;
  overflow: hidden;
}
.pd-deal-row {
  display: grid;
  grid-template-columns: 9rem auto;
  gap: 0.15rem 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.07));
}
.pd-deal-row:last-child {
  border-bottom: 0;
}
.pd-deal-label {
  grid-row: 1;
  color: var(--text-secondary, #6b6660);
  font-size: var(--text-sm);
  align-self: baseline;
}
.pd-deal-value {
  grid-row: 1;
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
}
.pd-deal-note {
  grid-column: 2;
  grid-row: 2;
  font-size: var(--text-sm);
  color: var(--text-secondary, #6b6660);
}

.pd-example {
  margin: 1.25rem 0 0;
  line-height: var(--leading-relaxed, 1.625);
}

/* Languages — a quiet list, not a feature grid. */
.pd-langs {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
}
.pd-lang {
  background: var(--bg-elevated, #ffffff);
  border-radius: 999px;
  padding: 0.35rem 0.85rem;
  font-size: var(--text-sm);
}

.pd-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1.25rem;
}
.pd-step {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}
.pd-step-num {
  flex: none;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--accent, #c23a3a);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pd-step-title {
  display: block;
  font-weight: var(--font-semibold);
}
.pd-step-text {
  display: block;
  color: var(--text-secondary, #6b6660);
  line-height: var(--leading-relaxed, 1.625);
}

.pd-practical {
  margin: 0;
  padding-left: 1.15rem;
  display: grid;
  gap: 0.6rem;
  line-height: var(--leading-relaxed, 1.625);
}

.pd-honesty {
  margin: 1.5rem 0 0;
  padding: 1rem 1.25rem;
  background: var(--bg-elevated, #ffffff);
  border-radius: 14px;
  line-height: var(--leading-relaxed, 1.625);
  color: var(--text-secondary, #6b6660);
}

.pd-cta {
  margin-top: 3.5rem;
  text-align: center;
}
.pd-cta-btn {
  display: inline-block;
  background: var(--accent, #c23a3a);
  color: #fff;
  text-decoration: none;
  font-weight: var(--font-semibold);
  padding: 0.9rem 2.25rem;
  border-radius: 999px;
}
.pd-cta-note {
  margin: 0.85rem 0 0;
  font-size: var(--text-sm);
  color: var(--text-secondary, #6b6660);
}

.pd-missing {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
