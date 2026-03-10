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
