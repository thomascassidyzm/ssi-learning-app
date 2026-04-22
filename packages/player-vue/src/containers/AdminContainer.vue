<script setup lang="ts">
import { useRoute } from 'vue-router'
import { ref, onMounted } from 'vue'

const route = useRoute()
const mounted = ref(false)

onMounted(() => {
  requestAnimationFrame(() => { mounted.value = true })
})
</script>

<template>
  <div class="admin-container" :class="{ 'is-mounted': mounted }">
    <header class="admin-header">
      <div class="header-chrome">
        <div class="header-inner">
          <div class="header-left">
            <router-link to="/" class="back-link" aria-label="Back to app">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>Back to App</span>
            </router-link>
            <div class="title-group">
              <h1 class="admin-title">SSi Admin</h1>
            </div>
          </div>
          <div class="header-shortcuts">
            <router-link to="/schools" class="shortcut-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              Schools
            </router-link>
            <router-link to="/demo" class="shortcut-link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Demo
            </router-link>
          </div>
          <nav class="admin-nav">
            <router-link
              :to="{ name: 'admin-schools' }"
              class="nav-link"
              :class="{ active: route.path.startsWith('/admin/schools') }"
            >
              <span class="nav-label">Schools</span>
            </router-link>
            <router-link
              to="/admin"
              class="nav-link"
              :class="{ active: route.path === '/admin' }"
            >
              <span class="nav-label">Invites</span>
            </router-link>
            <router-link
              to="/admin/entitlements"
              class="nav-link"
              :class="{ active: route.path === '/admin/entitlements' }"
            >
              <span class="nav-label">Access</span>
            </router-link>
            <router-link
              to="/admin/users"
              class="nav-link"
              :class="{ active: route.path.startsWith('/admin/users') }"
            >
              <span class="nav-label">Users</span>
            </router-link>
            <router-link
              to="/admin/courses"
              class="nav-link"
              :class="{ active: route.path === '/admin/courses' }"
            >
              <span class="nav-label">Courses</span>
            </router-link>
            <router-link
              to="/admin/analytics"
              class="nav-link"
              :class="{ active: route.path === '/admin/analytics' }"
            >
              <span class="nav-label">Analytics</span>
            </router-link>
            <router-link
              to="/admin/activity"
              class="nav-link"
              :class="{ active: route.path === '/admin/activity' }"
            >
              <span class="nav-label">Activity</span>
            </router-link>
            <router-link
              to="/admin/try-links"
              class="nav-link"
              :class="{ active: route.path === '/admin/try-links' }"
            >
              <span class="nav-label">Try Links</span>
            </router-link>
          </nav>
        </div>
      </div>
      <div class="header-accent" aria-hidden="true">
        <div class="accent-shimmer"></div>
      </div>
    </header>

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
      <router-link to="/admin" class="bottom-nav-item" :class="{ active: route.path === '/admin' }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span>Invites</span>
      </router-link>
      <router-link to="/admin/users" class="bottom-nav-item" :class="{ active: route.path.startsWith('/admin/users') }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <span>Users</span>
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
    </nav>
  </div>
</template>

<style scoped>
/* ================================================================
 * ADMIN CONTAINER — "Obsidian & Parchment"
 * Dark polished header, warm content area
 * ================================================================ */

.admin-container {
  height: 100vh;
  overflow-y: auto;
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* ================================================================
 * HEADER — Dark chrome with depth
 * Forces dark palette regardless of theme
 * ================================================================ */

.admin-header {
  position: sticky;
  top: 0;
  z-index: var(--z-nav);
  padding-top: env(safe-area-inset-top);
}

.header-chrome {
  background: #0c0c10;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.header-inner {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.875rem 2rem;
  max-width: var(--container-max);
  margin: 0 auto;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

/* Back link — muted, reveals on hover */
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  border-radius: 6px;
  font-family: var(--font-body);
  font-size: 0.6875rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
  text-decoration: none;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: all 0.2s ease;
}

.back-link:hover {
  color: var(--ssi-gold);
  background: rgba(255, 255, 255, 0.05);
}

.back-link svg {
  transition: transform 0.2s ease;
}

.back-link:hover svg {
  transform: translateX(-2px);
}

/* Title */
.title-group {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.admin-title {
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0;
  color: #ffffff;
  letter-spacing: 0.02em;
}

/* ================================================================
 * SHORTCUTS — Schools / Demo links in header
 * ================================================================ */

.header-shortcuts {
  display: flex;
  gap: 0.5rem;
}

.shortcut-link {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  text-decoration: none;
  transition: all 0.2s ease;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.shortcut-link:hover {
  color: var(--ssi-gold);
  border-color: rgba(212, 168, 83, 0.3);
  background: rgba(255, 255, 255, 0.04);
}

.shortcut-link svg {
  opacity: 0.6;
}

.shortcut-link:hover svg {
  opacity: 1;
}

/* ================================================================
 * NAV — Pill group with gold active state
 * ================================================================ */

.admin-nav {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  margin-left: auto;
}

.nav-link {
  position: relative;
  padding: 0.5rem 1rem;
  border-radius: 7px;
  font-family: var(--font-body);
  font-size: 0.8125rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.45);
  text-decoration: none;
  transition: all 0.25s ease;
  overflow: hidden;
}

.nav-link .nav-label {
  position: relative;
  z-index: 1;
}

/* Hover — subtle lift */
.nav-link:hover {
  color: rgba(255, 255, 255, 0.85);
}

/* Active — gold accent, lit from within */
.nav-link.active {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
}

.nav-link.active::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 2px;
  background: var(--ssi-gold);
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(212, 168, 83, 0.5);
}

/* ================================================================
 * ACCENT BAR — Living shimmer
 * ================================================================ */

.header-accent {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(194, 58, 58, 0.3) 15%,
    rgba(212, 168, 83, 0.5) 50%,
    rgba(194, 58, 58, 0.3) 85%,
    transparent 100%
  );
  position: relative;
  overflow: hidden;
}

.accent-shimmer {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(212, 168, 83, 0.6) 50%,
    transparent 100%
  );
  animation: shimmer 8s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% { left: -100%; opacity: 0; }
  10% { opacity: 1; }
  50% { left: 100%; opacity: 1; }
  60% { opacity: 0; }
}

/* ================================================================
 * MAIN CONTENT — Warm parchment
 * ================================================================ */

.admin-main {
  padding: 2rem;
  max-width: var(--container-max);
  margin: 0 auto;
  min-height: calc(100vh - 80px);
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

.admin-container:not(.is-mounted) .header-inner {
  opacity: 0;
  transform: translateY(-8px);
}

.admin-container.is-mounted .header-inner {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.admin-container:not(.is-mounted) .admin-main {
  opacity: 0;
}

.admin-container.is-mounted .admin-main {
  opacity: 1;
  transition: opacity 0.4s ease 0.15s;
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
    z-index: var(--z-nav);
    background: #0c0c10;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding: 0.5rem 0.25rem;
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0.375rem 0;
    text-decoration: none;
    color: rgba(255, 255, 255, 0.35);
    font-size: 10px;
    font-family: var(--font-body);
    font-weight: 500;
    transition: color 0.2s ease;
    border-radius: 8px;
  }

  .bottom-nav-item:hover,
  .bottom-nav-item.active {
    color: rgba(255, 255, 255, 0.9);
  }

  .bottom-nav-item.active svg {
    color: var(--ssi-gold);
    filter: drop-shadow(0 0 4px rgba(212, 168, 83, 0.4));
  }

  .bottom-nav-item.back-item {
    color: rgba(255, 255, 255, 0.5);
  }

  .bottom-nav-item.back-item:hover {
    color: var(--ssi-gold);
  }

  .admin-main {
    padding-bottom: calc(2rem + 70px) !important;
  }
}

/* ================================================================
 * RESPONSIVE
 * ================================================================ */

@media (max-width: 1024px) {
  .header-inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.875rem 1.25rem;
  }

  .admin-nav {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .admin-nav::-webkit-scrollbar {
    display: none;
  }

  .nav-link {
    white-space: nowrap;
    flex-shrink: 0;
  }
}

@media (max-width: 768px) {
  .header-shortcuts {
    display: none;
  }

  .header-inner {
    padding: 0.75rem 1rem;
  }

  .admin-main {
    padding: 1.25rem;
  }

  .back-link span {
    display: none;
  }

  .nav-link {
    padding: 0.4375rem 0.75rem;
    font-size: 0.75rem;
  }
}
</style>
