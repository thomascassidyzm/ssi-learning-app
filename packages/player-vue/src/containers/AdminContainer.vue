<script setup lang="ts">
import { useRoute } from 'vue-router'
import { ref, onMounted } from 'vue'
import AdminTopBar from '@/components/admin/AdminTopBar.vue'
import { useAdminGate } from '@/composables/useAdminGate'
import { usePullToRefresh } from '@/composables/usePullToRefresh'
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'

const route = useRoute()
const mounted = ref(false)

onMounted(() => {
  requestAnimationFrame(() => { mounted.value = true })
})

// Access gate — see useAdminGate for the full rationale (deny-not-defer +
// periodic re-validation so a mid-session downgrade revokes access live).
const { isCheckingAccess, isDenied } = useAdminGate()

// Pull-to-refresh: touch half of the ONE refresh protocol, same shared
// refresh() as the navbar button, fired from this scroll root.
const containerEl = ref<HTMLElement | null>(null)
const { pullDistance, isPulling } = usePullToRefresh(containerEl)
</script>

<template>
  <div ref="containerEl" class="admin-container schools-surface" :class="{ 'is-mounted': mounted }">
    <!-- Pull-to-refresh indicator (touch) — same action as the navbar refresh -->
    <div
      v-if="isPulling"
      class="pull-indicator"
      :style="{ transform: `translate(-50%, ${Math.min(pullDistance, 90)}px)` }"
    >
      <svg
        :style="{ transform: `rotate(${pullDistance * 3}deg)` }"
        width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </div>
    <div v-if="isCheckingAccess || isDenied" class="admin-loading">
      <div class="loading-spinner"></div>
      <p>Loading…</p>
    </div>
    <template v-else>
    <AdminTopBar />

    <main class="admin-main">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- Mobile bottom nav -->
    <nav class="bottom-nav">
      <router-link to="/" class="bottom-nav-item back-item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>App</span>
      </router-link>
      <router-link to="/schools" class="bottom-nav-item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span>Schools</span>
      </router-link>
      <router-link to="/admin/structure" class="bottom-nav-item" :class="{ active: route.path.startsWith('/admin/structure') }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>
        </svg>
        <span>Structure</span>
      </router-link>
      <router-link to="/admin/users" class="bottom-nav-item" :class="{ active: route.path.startsWith('/admin/users') }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <span>Users</span>
      </router-link>
      <router-link to="/admin/attention" class="bottom-nav-item" :class="{ active: route.path === '/admin/attention' }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>Attention</span>
      </router-link>
      <router-link to="/admin/courses" class="bottom-nav-item" :class="{ active: route.path === '/admin/courses' }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
        <span>Courses</span>
      </router-link>
      <router-link to="/admin/analytics" class="bottom-nav-item" :class="{ active: route.path === '/admin/analytics' }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
        <span>Stats</span>
      </router-link>
      <router-link to="/admin/release-notes" class="bottom-nav-item" :class="{ active: route.path === '/admin/release-notes' }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="8" y1="13" x2="16" y2="13"/>
          <line x1="8" y1="17" x2="16" y2="17"/>
        </svg>
        <span>What's New</span>
      </router-link>
    </nav>
    </template>
  </div>
</template>

<style scoped>
/* ================================================================
 * ADMIN CONTAINER — schools design system + dark top bar
 * Putty body, white cards, Arsenal headings, Open Sans body
 * Dark top bar signals "admin / elevated tooling" mode
 * ================================================================ */

.admin-container {
  height: 100vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--schools-bg, #f6f5f1);
  color: var(--schools-fg, #0F1212);
  position: relative;
}

.pull-indicator {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 8px);
  left: 50%;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #fff;
  color: #0F1212;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
  pointer-events: none;
}

/* ================================================================
 * MAIN CONTENT — putty parchment
 * ================================================================ */

.admin-main {
  flex: 1;
  padding: 28px 32px 40px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

/* Access-gate loading state (cold load with no cached role yet) */
.admin-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 16px;
  color: var(--schools-fg-3, #8a8078);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-subtle, rgba(44, 38, 34, 0.1));
  border-top-color: var(--schools-red, #DB1E17);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Page transition */
.page-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.page-leave-active {
  transition: opacity 0.15s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.page-leave-to {
  opacity: 0;
}

/* ================================================================
 * ENTRANCE ANIMATION
 * ================================================================ */

.admin-container:not(.is-mounted) .admin-main {
  opacity: 0;
}

.admin-container.is-mounted .admin-main {
  opacity: 1;
  transition: opacity 0.4s ease 0.05s;
}

/* ================================================================
 * BOTTOM NAV — Dark chrome, matching header
 * ================================================================ */

.bottom-nav {
  display: none;
}

@media (max-width: 768px) {
  .bottom-nav {
    display: flex;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 60;
    background: #050508;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding: 0.5rem 0.25rem;
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));
  }

  .bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0.375rem 0;
    text-decoration: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 10px;
    font-family: 'Open Sans', system-ui, sans-serif;
    font-weight: 500;
    transition: color 0.2s ease;
    border-radius: 8px;
  }

  .bottom-nav-item:hover,
  .bottom-nav-item.active {
    color: #fff;
  }

  .bottom-nav-item.active svg {
    color: var(--schools-gold, #FEC902);
  }

  .bottom-nav-item.back-item {
    color: rgba(255, 255, 255, 0.55);
  }

  .bottom-nav-item.back-item:hover {
    color: var(--schools-gold, #FEC902);
  }

  .admin-main {
    padding: 20px 16px calc(20px + 70px);
  }
}

@media (max-width: 1024px) {
  .admin-main {
    padding: 24px 20px;
  }
}
</style>
