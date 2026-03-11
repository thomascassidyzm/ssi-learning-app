<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="admin-container">
    <header class="admin-header">
      <div class="header-top">
        <div class="header-left">
          <router-link to="/" class="back-link" aria-label="Back to app">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Back to App</span>
          </router-link>
          <h1 class="admin-title">SSi Admin</h1>
        </div>
        <nav class="admin-nav">
          <router-link
            to="/admin"
            class="nav-link"
            :class="{ active: route.path === '/admin' }"
          >
            Codes
          </router-link>
          <router-link
            to="/admin/analytics"
            class="nav-link"
            :class="{ active: route.path === '/admin/analytics' }"
          >
            Analytics
          </router-link>
          <router-link
            to="/admin/users"
            class="nav-link"
            :class="{ active: route.path.startsWith('/admin/users') }"
          >
            Users
          </router-link>
          <router-link
            to="/admin/activity"
            class="nav-link"
            :class="{ active: route.path === '/admin/activity' }"
          >
            Activity
          </router-link>
          <router-link
            to="/admin/courses"
            class="nav-link"
            :class="{ active: route.path === '/admin/courses' }"
          >
            Courses
          </router-link>
          <router-link
            to="/admin/entitlements"
            class="nav-link"
            :class="{ active: route.path === '/admin/entitlements' }"
          >
            Entitlements
          </router-link>
        </nav>
      </div>
      <div class="header-accent" aria-hidden="true"></div>
    </header>
    <main class="admin-main">
      <router-view />
    </main>

    <!-- Mobile bottom nav -->
    <nav class="bottom-nav">
      <router-link to="/" class="bottom-nav-item back-item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span>App</span>
      </router-link>
      <router-link to="/admin" class="bottom-nav-item" :class="{ active: route.path === '/admin' }">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span>Codes</span>
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
.admin-container {
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.admin-header {
  position: sticky;
  top: 0;
  z-index: var(--z-nav);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
  backdrop-filter: blur(12px);
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-8);
  max-width: var(--container-max);
  margin: 0 auto;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-5);
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-muted);
  text-decoration: none;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.back-link:hover {
  color: var(--text-primary);
  background: var(--bg-card);
}

.admin-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
  margin: 0;
  color: var(--text-primary);
  letter-spacing: var(--tracking-wide);
}

.admin-nav {
  display: flex;
  gap: var(--space-1);
  background: var(--bg-card);
  padding: var(--space-1);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
}

.nav-link {
  position: relative;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-muted);
  text-decoration: none;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.nav-link:hover {
  color: var(--text-primary);
  background: var(--bg-card-hover);
}

.nav-link.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.nav-link.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 60%;
  height: 2px;
  background: var(--ssi-red);
  border-radius: var(--radius-full);
}

/* Accent gradient bar under header */
.header-accent {
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--ssi-red) 20%,
    var(--ssi-gold) 50%,
    var(--ssi-red) 80%,
    transparent 100%
  );
  opacity: 0.6;
}

.admin-main {
  padding: var(--space-8);
  max-width: var(--container-max);
  margin: 0 auto;
}

/* ============ BOTTOM NAV ============ */
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
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-subtle);
    padding: var(--space-2) var(--space-1);
    padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
    backdrop-filter: blur(12px);
  }

  .bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--space-1) 0;
    text-decoration: none;
    color: var(--text-muted);
    font-size: 10px;
    font-family: var(--font-body);
    font-weight: var(--font-medium);
    transition: color var(--transition-fast);
    border-radius: var(--radius-md);
  }

  .bottom-nav-item:hover,
  .bottom-nav-item.active {
    color: var(--text-primary);
  }

  .bottom-nav-item.active svg {
    color: var(--ssi-red);
  }

  .bottom-nav-item.back-item {
    color: var(--ssi-gold);
  }

  .bottom-nav-item.back-item:hover {
    color: var(--ssi-red);
  }

  .admin-main {
    padding-bottom: calc(var(--space-8) + 70px) !important;
  }
}

/* ============ RESPONSIVE ============ */
@media (max-width: 1024px) {
  .header-top {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
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
  .header-top {
    padding: var(--space-3) var(--space-4);
  }

  .admin-main {
    padding: var(--space-5);
  }

  .back-link span {
    display: none;
  }

  .nav-link {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
  }
}
</style>
