<script setup lang="ts">
import { ref, computed, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useGodMode } from '@/composables/schools/useGodMode'
import { useUserRole } from '@/composables/useUserRole'
import { isDemoMode } from '@/composables/demo/demoMode'

interface NavTab {
  name: string
  path: string
  label: string
}

const emit = defineEmits<{
  signIn: []
  signUp: []
}>()

const route = useRoute()
const router = useRouter()
const auth = inject<any>('auth')
const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')
const { selectedUser, isGovtAdmin } = useGodMode()
const { canAccessAdmin } = useUserRole()

// Derive auth state from injected auth composable
const isLoaded = computed(() => auth ? !auth.isLoading.value : true)
const isSignedIn = computed(() => auth?.isAuthenticated.value ?? false)
const user = computed(() => auth?.user.value ?? null)

const baseTabs: NavTab[] = [
  { name: 'dashboard', path: '/schools', label: 'Dashboard' },
  { name: 'teachers', path: '/schools/teachers', label: 'Teachers' },
  { name: 'students', path: '/schools/students', label: 'Students' },
  { name: 'classes', path: '/schools/classes', label: 'Classes' },
  { name: 'analytics', path: '/schools/analytics', label: 'Analytics' },
]

const tabs = computed(() => {
  const result = isGovtAdmin.value
    ? [{ name: 'all-schools', path: '/schools/all', label: 'Schools' }, ...baseTabs]
    : [...baseTabs]

  if (canAccessAdmin.value) {
    result.push({ name: 'setup', path: '/schools/setup', label: 'Setup' })
  }
  return result
})

// Computed user info from Supabase Auth
const userName = computed(() => {
  if (!isSignedIn.value || !user.value) return 'Guest'
  return user.value.email?.split('@')[0] || 'User'
})

const userEmail = computed(() => {
  if (!isSignedIn.value || !user.value) return ''
  return user.value.email || ''
})

const userInitials = computed(() => {
  if (!isSignedIn.value || !user.value) return '?'
  const name = user.value.email?.split('@')[0] || 'U'
  return name.charAt(0).toUpperCase()
})

// School info from God Mode selected user
const schoolName = computed(() => {
  return (selectedUser.value as any)?.school_name || 'Schools Dashboard'
})

const schoolInitials = computed(() => {
  return schoolName.value.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
})

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

// Sign out
const handleSignOut = async () => {
  isUserMenuOpen.value = false
  const client = supabaseRef?.value
  if (client) {
    await client.auth.signOut()
  }
}

// Mobile menu
const isMobileMenuOpen = ref(false)
const toggleMobileMenu = () => {
  isMobileMenuOpen.value = !isMobileMenuOpen.value
}
const closeMobileMenu = () => {
  isMobileMenuOpen.value = false
}

</script>

<template>
  <nav class="top-nav">
    <!-- Logo -->
    <router-link to="/schools" class="logo">
      <span class="logo-text">
        <span class="say">Say</span><span class="something">Something</span><span class="in">in</span>
      </span>
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

    <!-- Mobile Menu Button -->
    <button class="mobile-menu-btn" @click="toggleMobileMenu" aria-label="Menu">
      <svg v-if="!isMobileMenuOpen" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
      <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>

    <!-- Right Section -->
    <div class="nav-right">
      <!-- Learn Button (back to player, hidden in demo) -->
      <button v-if="!isDemoMode" class="learn-btn" @click="router.push('/')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="6 3 20 12 6 21 6 3"/>
        </svg>
        Learn
      </button>

      <!-- Auth Buttons (when not signed in) -->
      <template v-if="isLoaded && !isSignedIn">
        <button class="auth-btn auth-btn--secondary" @click="emit('signIn')">
          Sign In
        </button>
        <button class="auth-btn auth-btn--primary" @click="emit('signUp')">
          Get Started
        </button>
      </template>

      <!-- Authenticated User Section -->
      <template v-else-if="isLoaded && isSignedIn">
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
            <span class="user-avatar">{{ userInitials }}</span>
          </button>

          <!-- Dropdown -->
          <Transition name="dropdown">
            <div v-if="isUserMenuOpen" class="user-dropdown">
              <div class="user-dropdown-header">
                <span class="user-dropdown-name">{{ userName }}</span>
                <span class="user-dropdown-email">{{ userEmail }}</span>
              </div>
              <div class="user-dropdown-divider"></div>
              <router-link to="/schools/settings" class="user-dropdown-item" @click="isUserMenuOpen = false">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
                </svg>
                Settings
              </router-link>
              <button class="user-dropdown-item logout" @click="handleSignOut">
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
      </template>

      <!-- Loading skeleton -->
      <template v-else>
        <div class="auth-skeleton"></div>
      </template>
    </div>
  </nav>

  <!-- Mobile Menu Panel -->
  <Transition name="mobile-menu">
    <div v-if="isMobileMenuOpen" class="mobile-menu-panel">
      <router-link
        v-for="tab in tabs"
        :key="tab.name"
        :to="tab.path"
        class="mobile-menu-item"
        :class="{ active: isActive(tab.path) }"
        @click="closeMobileMenu"
      >
        {{ tab.label }}
      </router-link>
      <router-link
        v-if="!isDemoMode"
        to="/"
        class="mobile-menu-item mobile-menu-learn"
        @click="closeMobileMenu"
      >
        Learn
      </router-link>
    </div>
  </Transition>
  <div v-if="isMobileMenuOpen" class="mobile-menu-backdrop" @click="closeMobileMenu"></div>
</template>

<style scoped>
.top-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: calc(var(--nav-height) + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  background: var(--nav-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: var(--space-6);
  padding-right: var(--space-6);
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

/* Learn Button */
.learn-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-red-dark, #9a2e2e));
  border: none;
  border-radius: var(--radius-lg);
  color: white;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: all var(--transition-base);
}

.learn-btn:hover {
  box-shadow: 0 4px 15px rgba(194, 58, 58, 0.4);
  transform: translateY(-1px);
}

.learn-btn svg {
  flex-shrink: 0;
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

/* Auth Buttons */
.auth-btn {
  padding: 0.5rem 1rem;
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: all var(--transition-base);
}

.auth-btn--secondary {
  background: transparent;
  border: 1px solid var(--border-medium);
  color: var(--text-secondary);
}

.auth-btn--secondary:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}

.auth-btn--primary {
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-red-dark));
  border: none;
  color: white;
}

.auth-btn--primary:hover {
  box-shadow: 0 4px 15px rgba(194, 58, 58, 0.4);
  transform: translateY(-1px);
}

/* User Avatar */
.user-avatar {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  font-weight: var(--font-bold);
  color: white;
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-gold));
  border-radius: 50%;
}

.user-dropdown-email {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 2px;
}

/* Auth Skeleton */
.auth-skeleton {
  width: 120px;
  height: 36px;
  background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-elevated) 50%, var(--bg-card) 75%);
  background-size: 200% 100%;
  border-radius: var(--radius-lg);
  animation: skeleton-shimmer 1.5s infinite;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Mobile Menu Button */
.mobile-menu-btn {
  display: none;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background var(--transition-base);
}

.mobile-menu-btn:hover {
  background: var(--bg-elevated);
}

/* Mobile Menu Panel */
.mobile-menu-panel {
  position: fixed;
  top: calc(var(--nav-height) + env(safe-area-inset-top, 0px));
  left: 0;
  right: 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-lg);
  z-index: calc(var(--z-nav) - 1);
  padding: var(--space-2) 0;
}

.mobile-menu-item {
  display: block;
  padding: var(--space-3) var(--space-6);
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
  text-decoration: none;
  transition: all var(--transition-base);
}

.mobile-menu-item:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.mobile-menu-item.active {
  color: var(--ssi-red);
  font-weight: var(--font-semibold);
}

.mobile-menu-learn {
  border-top: 1px solid var(--border-subtle);
  margin-top: var(--space-2);
  padding-top: var(--space-4);
  color: var(--ssi-red);
  font-weight: var(--font-semibold);
}

.mobile-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-nav) - 2);
  background: rgba(0, 0, 0, 0.2);
}

/* Mobile menu transitions */
.mobile-menu-enter-active,
.mobile-menu-leave-active {
  transition: all 0.2s ease;
}

.mobile-menu-enter-from,
.mobile-menu-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Responsive */
@media (max-width: 768px) {
  .top-nav {
    padding-left: var(--space-4);
    padding-right: var(--space-4);
  }

  .mobile-menu-btn {
    display: flex;
  }

  .nav-tabs {
    display: none;
  }

  .school-badge {
    display: none;
  }

  .learn-btn {
    display: none;
  }

  .auth-btn--secondary {
    display: none;
  }

  .auth-btn--primary {
    padding: 0.5rem 0.75rem;
    font-size: var(--text-xs);
  }
}
</style>
