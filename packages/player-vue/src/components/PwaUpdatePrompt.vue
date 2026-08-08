<script setup lang="ts">
/**
 * PwaUpdatePrompt — Banner shown when a new service worker is waiting.
 *
 * Update → activates the new SW and reloads.
 * Dismiss → hides the banner; the logo blue dot (in LearningPlayer)
 * takes over as a subtle indicator until the user clicks it (same action
 * as Update) or the next SW update arrives.
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  updateAvailable, userDismissed, setApplyUpdate,
  isDifferentBuild, fetchLatestBuildNumber,
} from '@/composables/usePwaUpdate'
import { RELOAD_WEDGE_MS } from '@/utils/bootHeal'

// Never interrupt an active cycle (B6/Gap 4) — the banner still appears
// promptly since it re-evaluates on every play/pause tick, and rounds are
// ~11s apart, so it surfaces at the very next natural pause rather than
// mid-speech.
const isPlaying = ref(false)
function onPlayState(e: Event) {
  isPlaying.value = !!(e as CustomEvent).detail?.playing
}

// @ts-ignore - __BUILD_NUMBER__ is defined by Vite (same pattern as App.vue).
const BUILD_VERSION = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev'

let updateCheckInterval: ReturnType<typeof setInterval> | null = null

const {
  needRefresh,
} = useRegisterSW({
  immediate: true,
  onRegistered(registration) {
    console.log('[PWA] Service worker registered')
    if (registration) {
      // Check for a new build every 5 minutes. This is a background SW update
      // poll, not dashboard data — a new deploy still surfaces well within a
      // sitting, but at 1/5min it stops reading as "auto-refresh" idle chatter
      // in the Network tab (founder ruling, 2026-07-19).
      updateCheckInterval = setInterval(() => {
        registration.update().catch(() => {})
      }, 5 * 60 * 1000)
    }
  },
  onRegisterError(error) {
    console.error('[PWA] Service worker registration error:', error)
  },
})

// needRefresh only means "a new SW is waiting" — NOT "the running app is
// behind". Navigations are NetworkFirst, so the page can already be on the
// latest build before the new SW finishes installing; verify against the
// build actually live (/version.json) before surfacing anything. Starts
// false so nothing flashes while the check is in flight.
const verifiedNewBuild = ref(false)

async function verifyAgainstLiveBuild() {
  const latest = await fetchLatestBuildNumber()
  // needRefresh may have flipped back false while we were checking (or this
  // is a re-check for a build we already verified) — only act if still relevant.
  if (!needRefresh.value) return
  if (isDifferentBuild(BUILD_VERSION, latest)) {
    verifiedNewBuild.value = true
    userDismissed.value = false // fresh, genuine notification — clear any stale dismissal
  } else {
    console.log('[PWA] needRefresh fired but /version.json matches the running build — suppressing stale banner')
    verifiedNewBuild.value = false
  }
}

watch(needRefresh, (v) => {
  if (v) {
    void verifyAgainstLiveBuild()
  } else {
    verifiedNewBuild.value = false
  }
}, { immediate: true })

// Mirror the verified signal into the shared ref so the blue dot (rendered
// elsewhere) can react.
watch(verifiedNewBuild, (v) => { updateAvailable.value = v })

// Banner is visible only until the user dismisses — then the dot takes over.
// Also held back while a cycle is actively playing (never interrupt).
// `reloadWedged` overrides all of it: if the update navigation didn't take,
// the one thing that unsticks the webview is another user gesture, so the
// banner comes back as a relaunch button whatever else is going on.
const showBanner = computed(() =>
  reloadWedged.value || (verifiedNewBuild.value && !userDismissed.value && !isPlaying.value))

// Applying an update must NEVER leave a live page running under the newly
// activated service worker. The instant the new SW activates, Workbox's
// precache cleanup deletes every chunk whose content changed — so a document
// that is still alive at that moment has had a chunk of its own code deleted
// from under it (measured: 10 of 21 entry chunks, e2e/sw-update-probe.mjs S2),
// and they're gone from the origin too after a deploy. The next lazy import —
// opening Settings, the next route, the next round — 404s and the app dies.
// That is Tom's "it crashes halfway through updating, then you reopen it and
// it's finished": the crash is the old document losing its code, and the
// relaunch is a clean load of the new build.
//
// The old flow called updateServiceWorker(true), which posts SKIP_WAITING and
// leaves the reload to vite-plugin-pwa's `controlling` listener. On iOS
// standalone a location.reload() fired from that async event can silently not
// take (same wedge as commit 03f007ae) — and then the page sits there, alive
// and gutted.
//
// So the app never activates a waiting worker at all. Taking the update is
// just a plain reload, fired synchronously inside the user's tap — a
// gesture-initiated navigation is the one iOS reliably honours. Navigations
// are NetworkFirst, so that reload fetches the new index.html and its new
// chunks straight from the origin: the learner is on the new build the moment
// the page comes back, with the old worker still quietly serving its own
// precache. The waiting worker takes over later, on its own, the first time
// no client is open — which is precisely when nothing can be hurt by it.
//
// Posting SKIP_WAITING even at `pagehide` was tried and is WRONG: the worker
// then activates while the reload navigation is still in flight, its
// NetworkFirst fetch dies with it, and the navigation falls back to the
// precached OLD index.html — the update visibly doesn't apply (measured with
// e2e/sw-update-probe.mjs; the page came back on the old entry chunk).
//
// If the navigation doesn't take, nothing has been destroyed — the page keeps
// every chunk it had, and the banner returns as "tap to relaunch".
const reloadWedged = ref(false)

function onUpdate() {
  console.log('[PWA] Updating...')
  updateAvailable.value = false
  verifiedNewBuild.value = false
  userDismissed.value = false

  // If the navigation silently doesn't take (wedged iOS webview), offer a
  // second tap rather than a dead app — the same escape hatch, and the same
  // timing, as the boot watchdog's "tap to relaunch" (utils/bootHeal.ts).
  setTimeout(() => { reloadWedged.value = true }, RELOAD_WEDGE_MS)

  window.location.reload()
}

function onDismiss() {
  userDismissed.value = true
}

// The wedge escape: a fresh user gesture, which is what an iOS standalone
// webview needs before it will honour a navigation.
function onRelaunch() {
  window.location.reload()
}

// Let the blue dot trigger the same action.
setApplyUpdate(onUpdate)

onMounted(() => {
  window.addEventListener('ssi-play-state', onPlayState)
})

onUnmounted(() => {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval)
  }
  window.removeEventListener('ssi-play-state', onPlayState)
})
</script>

<template>
  <!-- Teleport to body so the banner lives in the root stacking context.
       Any parent with transform/filter/opacity could otherwise create a
       new stacking context that traps the banner below floating UI like
       the mode-tray trigger button. -->
  <Teleport to="body">
    <Transition name="slide-down">
      <div v-if="showBanner" class="pwa-update-banner" role="status" aria-live="polite">
        <div v-if="reloadWedged" class="pwa-update-content">
          <span class="pwa-update-text">Update ready</span>
          <div class="pwa-update-actions">
            <button class="pwa-update-button" @click.stop="onRelaunch">
              Tap to relaunch
            </button>
          </div>
        </div>
        <div v-else class="pwa-update-content">
          <span class="pwa-update-text">New version available</span>
          <div class="pwa-update-actions">
            <button class="pwa-update-dismiss" @click.stop="onDismiss">
              Later
            </button>
            <button class="pwa-update-button" @click.stop="onUpdate">
              Update
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Top-anchored, like InstallBanner — the bottom band is the mode-tray's
   territory (B6). Sits a banner-height below the top edge so it stacks
   under InstallBanner rather than covering it on the rare session where
   both would otherwise qualify to show. */
.pwa-update-banner {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 76px);
  left: 0;
  right: 0;
  /* Max int32 — guarantees we sit above any other floating UI (mode tray,
     overlays, modals). The update banner is critical-path: a learner
     should always be able to take a code update. */
  z-index: 2147483647;
  padding: 0 16px;
  pointer-events: none;
}

.pwa-update-content {
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  max-width: 400px;
  margin: 0 auto;
}

.pwa-update-text {
  color: #e0e0e0;
  font-size: 14px;
  font-weight: 500;
}

.pwa-update-actions {
  display: flex;
  gap: 8px;
}

.pwa-update-dismiss {
  background: transparent;
  border: 1px solid #2a2a4a;
  color: #888;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pwa-update-dismiss:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
}

.pwa-update-button {
  background: var(--info, #60a5fa);
  border: none;
  color: #0b1220;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pwa-update-button:hover {
  filter: brightness(1.1);
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
