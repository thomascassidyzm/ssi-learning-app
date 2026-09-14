<script setup lang="ts">
/**
 * ViewingAsBanner — the unmissable strip shown whenever an ssi_admin is
 * viewing the app as somebody else. Rendered globally from App.vue, so it is
 * on EVERY page for as long as view-as is on, and its Exit is one tap back to
 * the admin's own identity.
 *
 * A silent impersonation mode is worse than none: this is deliberately loud
 * (amber, fixed, above everything) and names the persona and their scope.
 *
 * It is a FULL-WIDTH BAND ACROSS THE TOP, not a floating pill, and it PUSHES
 * the page down rather than sitting on it (Tom, 2026-09-14 14:50Z, job #675:
 * "this Viewing As feature is great BUT it blocks all my nav functionality").
 * The pill was centred over the schools top bar, and on a phone it did not
 * merely look wrong: the hamburger and the avatar were untappable, because the
 * pill swallowed the taps. Of the ways to get it off the nav, this is the
 * cheapest that works on EVERY surface at once — the band publishes its own
 * measured height as `--viewing-as-h` and one global rule in style.css pads
 * the body by it, so in-flow shells (schools, org lens) move down for free and
 * only the handful of fixed top chrome (the tutor nav, the player escape) name
 * the variable. The alternative, a strip rendered per-shell under each header,
 * is the same offset written four times and forgotten on the fifth.
 */
import { computed, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserRole, roleLabel } from '@/composables/useUserRole'
import { useViewAs } from '@/composables/useViewAs'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { viewAsPages } from '@/composables/viewAsPages'

const { viewingAs, isViewingAs } = useUserRole()
const { stopViewing } = useViewAs()
const { currentUser } = useSchoolContext()
const router = useRouter()
const route = useRoute()

// The page list: every page this persona can reach, so checking the product
// is walking a list rather than remembering URLs.
const showPages = ref(false)
const pages = computed(() => {
  const p = viewingAs.value
  if (!p) return []
  const node = currentUser.value?.school_id ?? currentUser.value?.group_id ?? null
  return viewAsPages(router, p, node)
})
function go(path: string): void {
  showPages.value = false
  void router.push(path)
}

const label = computed(() => {
  const p = viewingAs.value
  if (!p) return ''
  const school = currentUser.value?.school_name
  // Role-only view-as has no person to name — the role IS the identity.
  const who = p.userId ? p.name : `any ${roleLabel(p.role).toLowerCase()}`
  const parts = [p.userId ? roleLabel(p.role) : null, school].filter(Boolean)
  return parts.length ? `${who} · ${parts.join(' · ')}` : who
})

// The band's own height, published to the document so everything else can get
// out of its way. Measured rather than hard-coded: the text wraps to a second
// line on a narrow phone, and a guessed constant would be wrong exactly there.
const band = ref<HTMLElement | null>(null)
let ro: ResizeObserver | null = null
function publish(h: number): void {
  const el = document.documentElement
  if (h > 0) {
    el.style.setProperty('--viewing-as-h', `${Math.round(h)}px`)
    el.classList.add('is-viewing-as')
  } else {
    el.style.removeProperty('--viewing-as-h')
    el.classList.remove('is-viewing-as')
  }
}
watch(
  [isViewingAs, band],
  async () => {
    ro?.disconnect(); ro = null
    if (!isViewingAs.value) { publish(0); return }
    await nextTick()
    const el = band.value
    if (!el) return
    publish(el.offsetHeight)
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => publish(el.offsetHeight))
      ro.observe(el)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => { ro?.disconnect(); publish(0) })
</script>

<template>
  <div v-if="isViewingAs" ref="band" class="viewing-as-banner" role="status" aria-live="polite">
    <span class="aab-eye" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </span>
    <span class="aab-text">Viewing as <strong>{{ label }}</strong> — read only</span>
    <button
      v-if="pages.length"
      type="button"
      class="aab-pages"
      data-testid="view-as-pages"
      :aria-expanded="showPages"
      @click="showPages = !showPages"
    >
      Pages<span class="aab-count">{{ pages.length }}</span>
    </button>
    <button type="button" class="aab-exit" data-testid="view-as-exit" @click="stopViewing">Exit</button>

    <div v-if="showPages" class="aab-menu">
      <p class="aab-menu-head">Every page this account can reach</p>
      <button
        v-for="p in pages"
        :key="p.path"
        type="button"
        class="aab-menu-item"
        :class="{ 'is-here': p.path === route.path }"
        @click="go(p.path)"
      >
        <span class="aab-menu-title">{{ p.title }}</span>
        <span class="aab-menu-path">{{ p.path }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.viewing-as-banner {
  position: fixed;
  /* A band across the very top, above every shell. The page is padded down by
     this band's height (style.css, html.is-viewing-as), so it covers nothing.
     Safe-area inset keeps the content clear of the iOS status bar / notch and
     the left/right insets cover landscape notches — standing rule. */
  top: 0;
  left: 0;
  right: 0;
  z-index: 2147483000;
  display: flex;
  /* One line, always: wrapping would break BEFORE the text shrank, and a
     two-row band on a phone eats the dashboard it exists to let you use.
     The text ellipsises instead; Pages and Exit never move. */
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: calc(env(safe-area-inset-top, 0px) + 7px) max(10px, env(safe-area-inset-right, 0px)) 7px
    max(10px, env(safe-area-inset-left, 0px));
  background: #b45309;
  color: #fff;
  font-family: 'Open Sans', 'Trebuchet MS', system-ui, Arial, sans-serif;
  font-size: 13px;
  line-height: 1;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
}
.aab-eye {
  display: inline-flex;
  opacity: 0.9;
}
.aab-text {
  /* Shrinks to an ellipsis rather than wrapping the buttons onto a second row:
     a phone-height band eats the dashboard it is meant to let you use. */
  flex: 0 1 auto;
  min-width: 0;
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
.aab-pages {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  flex: none;
}
.aab-pages:hover {
  background: rgba(255, 255, 255, 0.28);
}
.aab-count {
  font-weight: 700;
  opacity: 0.85;
}
.aab-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: min(340px, calc(100vw - 24px));
  max-height: 60vh;
  overflow-y: auto;
  background: #fff;
  color: #14110f;
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
  padding: 8px;
  text-align: left;
}
.aab-menu-head {
  margin: 6px 8px 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7a716a;
}
.aab-menu-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  text-align: left;
  font: inherit;
  background: none;
  border: none;
  border-radius: 8px;
  padding: 7px 8px;
  cursor: pointer;
  color: inherit;
}
.aab-menu-item:hover {
  background: rgba(15, 18, 18, 0.06);
}
.aab-menu-item.is-here {
  background: #fff7ed;
}
.aab-menu-title {
  font-size: 14px;
  font-weight: 600;
}
.aab-menu-path {
  font-size: 12px;
  color: #7a716a;
}
</style>
