<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'

interface NavTab {
  name: string
  path: string
  label: string
}

const route = useRoute()

const tabs: NavTab[] = [
  { name: 'dashboard', path: '/schools', label: 'Dashboard' },
  { name: 'teachers', path: '/schools/teachers', label: 'Teachers' },
  { name: 'students', path: '/schools/students', label: 'Students' },
  { name: 'classes', path: '/schools/classes', label: 'Classes' },
  { name: 'analytics', path: '/schools/analytics', label: 'Analytics' },
]

// School info (would come from auth/store in real app)
const schoolName = ref('Ysgol Cymraeg')
const schoolInitials = ref('YC')
const userName = ref('Admin')


// Check if tab is active
const isActive = (path: string) => {
  if (path === '/schools') {
    return route.path === '/schools'
  }
  return route.path.startsWith(path)
}

// User menu state
const isUserMenuOpen = ref(false)
const toggleUserMenu = () => {
  isUserMenuOpen.value = !isUserMenuOpen.value
}
</script>

<template>
  <nav class="top-nav">
    <!-- Logo -->
    <router-link to="/schools" class="logo">
      <span class="logo-text">
        <span class="say">Say</span><span class="something">Something</span><span class="in">in</span>
      </span>
      <span class="logo-bubble" aria-hidden="true"></span>
    </router-link>

    <!-- Navigation Tabs -->
    <div class="nav-tabs">
      <router-link
        v-for="tab in tabs"
        :key="tab.name"
        :to="tab.path"
        class="nav-tab"
        :class="{ active: isActive(tab.path) }"
      >
        {{ tab.label }}
      </router-link>
    </div>

    <!-- Right Section -->
    <div class="nav-right">
      <!-- School Badge -->
      <div class="school-badge">
        <div class="school-avatar">{{ schoolInitials }}</div>
        <span class="school-name">{{ schoolName }}</span>
      </div>

      <!-- User Menu -->
      <div class="user-menu-container">
        <button
          class="user-menu"
          @click="toggleUserMenu"
          aria-label="User menu"
          :aria-expanded="isUserMenuOpen"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>
          </svg>
        </button>

        <!-- Dropdown (placeholder for future) -->
        <Transition name="dropdown">
          <div v-if="isUserMenuOpen" class="user-dropdown">
            <div class="user-dropdown-header">
              <span class="user-dropdown-name">{{ userName }}</span>
              <span class="user-dropdown-role">School Administrator</span>
            </div>
            <div class="user-dropdown-divider"></div>
            <router-link to="/schools/settings" class="user-dropdown-item" @click="isUserMenuOpen = false">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
              </svg>
              Settings
            </router-link>
            <button class="user-dropdown-item logout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign Out
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.top-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--nav-height);
  background: var(--nav-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  z-index: var(--z-nav);
}

/* Logo */
.logo {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
}

.logo-text {
  font-family: var(--font-display);
  font-weight: var(--font-bold);
  font-size: var(--text-xl);
}

.logo-text .say {
  color: var(--ssi-red);
}

.logo-text .something {
  color: var(--text-primary);
}

.logo-text .in {
  color: var(--ssi-red);
}

.logo-bubble {
  width: 20px;
  height: 16px;
  border: 2px solid var(--ssi-red);
  border-radius: 3px;
  position: relative;
}

.logo-bubble::after {
  content: '';
  position: absolute;
  bottom: -6px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-right: 2px solid var(--ssi-red);
  border-bottom: 2px solid var(--ssi-red);
  transform: rotate(45deg);
  background: var(--logo-bubble-bg);
}

/* Navigation Tabs */
.nav-tabs {
  display: flex;
  gap: var(--space-1);
  background: var(--bg-card);
  padding: var(--space-1);
  border-radius: var(--radius-lg);
}

.nav-tab {
  padding: var(--space-2) var(--space-5);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: all var(--transition-base);
  text-decoration: none;
}

.nav-tab:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.nav-tab.active {
  background: var(--ssi-red);
  color: white;
}

/* Right Section */
.nav-right {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

/* School Badge */
.school-badge {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4) var(--space-2) var(--space-3);
  background: var(--bg-card);
  border-radius: var(--radius-2xl);
  border: 1px solid var(--border-subtle);
}

.school-avatar {
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-bold);
  font-size: var(--text-xs);
  color: white;
}

.school-name {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

/* User Menu */
.user-menu-container {
  position: relative;
}

.user-menu {
  width: 40px;
  height: 40px;
  background: var(--bg-card);
  border-radius: var(--radius-full);
  border: 2px solid var(--border-medium);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-base);
}

.user-menu:hover {
  border-color: var(--ssi-red);
}

.user-menu svg {
  width: 20px;
  height: 20px;
  color: var(--text-secondary);
}

/* User Dropdown */
.user-dropdown {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  min-width: 200px;
  background: var(--bg-card);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  z-index: var(--z-dropdown);
}

.user-dropdown-header {
  padding: var(--space-4);
  background: var(--bg-secondary);
}

.user-dropdown-name {
  display: block;
  font-weight: var(--font-semibold);
  margin-bottom: var(--space-1);
}

.user-dropdown-role {
  display: block;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.user-dropdown-divider {
  height: 1px;
  background: var(--border-subtle);
}

.user-dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all var(--transition-base);
  text-decoration: none;
}

.user-dropdown-item:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.user-dropdown-item.logout:hover {
  background: var(--error-muted);
  color: var(--error);
}

/* Dropdown animation */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all var(--transition-base);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Responsive */
@media (max-width: 768px) {
  .top-nav {
    padding: 0 var(--space-4);
  }

  .nav-tabs {
    display: none;
  }

  .school-badge {
    display: none;
  }
}
</style>
