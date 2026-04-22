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
const { canAccessAdmin, hasSchoolRole } = useUserRole()

declare const __BUILD_NUMBER__: string
const buildNumber = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev'

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
  const result: NavTab[] = []
  if (isGovtAdmin.value) {
    result.push({ name: 'all-schools', path: '/schools/all', label: 'Schools' })
  }
  // Show school-owner tabs for actual school roles, or when god is
  // actively impersonating a user with a school context.
  if (hasSchoolRole.value || selectedUser.value) {
    result.push(...baseTabs)
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
  <nav class="top-nav" :aria-label="'Schools navigation'">
    <!-- Logo -->
    <router-link to="/schools" class="logo" aria-label="SaySomethingin — Schools">
      <span class="logo-text">
        <span class="say">Say</span><span class="something">Something</span><span class="in">in</span>
      </span>
      <span class="logo-build mono">{{ buildNumber }}</span>
    </router-link>

    <!-- Navigation Tabs (desktop) -->
    <div class="nav-tabs" role="tablist" v-if="tabs.length > 0">
      <router-link
        v-for="tab in tabs"
        :key="tab.name"
        :to="tab.path"
        class="nav-tab"
        :class="{ active: isActive(tab.path) }"
        :aria-current="isActive(tab.path) ? 'page' : undefined"
      >
        <span class="nav-tab-label">{{ tab.label }}</span>
      </router-link>
    </div>
    <div v-else class="nav-tabs-spacer" aria-hidden="true"></div>

    <!-- Mobile Menu Button -->
    <button class="mobile-menu-btn" @click="toggleMobileMenu" aria-label="Menu">
      <svg v-if="!isMobileMenuOpen" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
        <line x1="4" y1="7" x2="20" y2="7"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <line x1="4" y1="17" x2="20" y2="17"/>
      </svg>
      <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>

    <!-- Right Section -->
    <div class="nav-right">
      <!-- Admin Button (SSi admins only) -->
      <button v-if="canAccessAdmin && !isDemoMode" class="chip-btn" @click="router.push('/admin')">
        <svg class="chip-btn-glyph" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3l8 3v6c0 4.5-3.3 8.2-8 9-4.7-.8-8-4.5-8-9V6z"/>
        </svg>
        Admin
      </button>

      <!-- Learn Button (back to player, hidden in demo) -->
      <button v-if="!isDemoMode" class="learn-btn" @click="router.push('/')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="6 3 20 12 6 21 6 3"/>
        </svg>
        <span>Learn</span>
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
        <div class="school-badge" :title="schoolName">
          <div class="school-badge-avatar">
            <span>{{ schoolInitials }}</span>
          </div>
          <span class="school-badge-name">{{ schoolName }}</span>
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
                </svg>
                Settings
              </router-link>
              <button class="user-dropdown-item logout" @click="handleSignOut">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
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
        v-if="canAccessAdmin && !isDemoMode"
        to="/admin"
        class="mobile-menu-item"
        @click="closeMobileMenu"
      >
        Admin
      </router-link>
      <router-link
        v-if="!isDemoMode"
        to="/demo"
        class="mobile-menu-item"
        @click="closeMobileMenu"
      >
        Demo
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
/* ============================================================
 * FROSTWELL TOP NAV
 * Translucent white glass over the mist canvas.
 * Concave tab rail with a raised active pill + tiny gold underline.
 * ============================================================ */
.top-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: calc(var(--nav-height) + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  padding-left: clamp(var(--space-4), 3vw, var(--space-8));
  padding-right: clamp(var(--space-4), 3vw, var(--space-8));

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);

  background: rgba(255, 255, 255, 0.72);
  -webkit-backdrop-filter: blur(32px) saturate(180%);
  backdrop-filter: blur(32px) saturate(180%);
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.6) inset,
              0 6px 20px rgba(44, 38, 34, 0.04);
  z-index: var(--z-nav);
}

@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .top-nav {
    background: rgba(255, 255, 255, 0.96);
  }
}

/* ============================================================
 * LOGO
 * ============================================================ */
.logo {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  text-decoration: none;
  flex-shrink: 0;
  padding: 4px 2px;
  border-radius: var(--radius-md);
}

.logo:focus-visible {
  outline: 2px solid rgba(194, 58, 58, 0.5);
  outline-offset: 2px;
}

.logo-text {
  font-family: var(--font-display);
  font-weight: var(--font-bold);
  font-size: var(--text-xl);
  letter-spacing: -0.01em;
  line-height: 1;
}

.logo-text .say {
  color: var(--ssi-red);
}

.logo-text .something {
  color: #2C2622;
}

.logo-text .in {
  color: var(--ssi-red);
}

.logo-build {
  font-size: 10px;
  color: #B5AEA6;
  letter-spacing: 0.02em;
  align-self: center;
}

/* ============================================================
 * NAVIGATION TABS
 * Concave rail + raised active pill with gold underline.
 * ============================================================ */
.nav-tabs {
  position: relative;
  display: inline-flex;
  gap: 2px;
  padding: 5px;
  background: rgba(44, 38, 34, 0.05);
  border-radius: var(--radius-full);
  box-shadow:
    inset 0 1px 2px rgba(44, 38, 34, 0.08),
    inset 0 0 0 1px rgba(44, 38, 34, 0.02);
}

.nav-tabs-spacer {
  flex: 1;
}

.nav-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 18px;
  border-radius: var(--radius-full);
  background: transparent;
  color: #4A4440;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  letter-spacing: -0.005em;
  text-decoration: none;
  cursor: pointer;
  transition:
    background var(--transition-base),
    color var(--transition-base),
    box-shadow var(--transition-base),
    transform var(--transition-base);
}

.nav-tab:hover {
  color: #2C2622;
  background: rgba(255, 255, 255, 0.55);
}

.nav-tab.active {
  color: #2C2622;
  background: #ffffff;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.95) inset,
    0 1px 3px rgba(44, 38, 34, 0.08),
    0 2px 6px rgba(44, 38, 34, 0.06);
}

/* Tiny gold underline dot for active */
.nav-tab.active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -9px;
  transform: translateX(-50%);
  width: 18px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--ssi-gold-dark), transparent);
  opacity: 0.85;
}

.nav-tab:focus-visible {
  outline: 2px solid rgba(194, 58, 58, 0.5);
  outline-offset: 3px;
}

/* ============================================================
 * RIGHT SECTION
 * ============================================================ */
.nav-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* Admin chip */
.chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px 7px 12px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.09);
  border-radius: var(--radius-full);
  color: #4A4440;
  font-size: var(--text-sm);
  font-family: var(--font-body);
  font-weight: var(--font-medium);
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
  transition:
    background var(--transition-base),
    border-color var(--transition-base),
    color var(--transition-base),
    box-shadow var(--transition-base);
}

.chip-btn:hover {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(212, 168, 83, 0.45);
  color: #2C2622;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 2px 8px rgba(212, 168, 83, 0.18);
}

.chip-btn-glyph {
  color: var(--ssi-gold-dark);
  flex-shrink: 0;
}

/* Learn button */
.learn-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 16px;
  background: linear-gradient(180deg, #d94545 0%, #a83232 100%);
  border: none;
  border-radius: var(--radius-full);
  color: white;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  letter-spacing: -0.005em;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    0 2px 6px rgba(194, 58, 58, 0.26),
    0 6px 18px rgba(194, 58, 58, 0.14);
  transition:
    transform var(--transition-base),
    box-shadow var(--transition-base);
}

.learn-btn:hover {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    0 3px 10px rgba(194, 58, 58, 0.34),
    0 10px 24px rgba(194, 58, 58, 0.2);
}

.learn-btn:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.8);
  outline-offset: 2px;
}

.learn-btn svg {
  flex-shrink: 0;
}

/* ============================================================
 * SCHOOL BADGE
 * ============================================================ */
.school-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 5px 14px 5px 5px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  max-width: 240px;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
}

.school-badge-avatar {
  position: relative;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ssi-red) 0%, var(--ssi-gold) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: var(--font-bold);
  font-size: 11px;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 1px 3px rgba(194, 58, 58, 0.22);
}

.school-badge-name {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: #2C2622;
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============================================================
 * USER MENU
 * ============================================================ */
.user-menu-container {
  position: relative;
}

.user-menu {
  width: 38px;
  height: 38px;
  padding: 0;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 50%;
  border: 1px solid rgba(44, 38, 34, 0.08);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8) inset;
  transition:
    transform var(--transition-base),
    border-color var(--transition-base),
    box-shadow var(--transition-base);
}

.user-menu:hover {
  border-color: rgba(194, 58, 58, 0.45);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9) inset,
    0 2px 8px rgba(194, 58, 58, 0.15);
}

.user-menu:focus-visible {
  outline: 2px solid rgba(194, 58, 58, 0.6);
  outline-offset: 2px;
}

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
  letter-spacing: 0.02em;
}

/* ============================================================
 * USER DROPDOWN
 * ============================================================ */
.user-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  min-width: 220px;
  background: rgba(255, 255, 255, 0.88);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(44, 38, 34, 0.1);
  border-radius: 14px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.8) inset,
    0 4px 12px rgba(44, 38, 34, 0.1),
    0 24px 60px rgba(44, 38, 34, 0.14);
  overflow: hidden;
  z-index: var(--z-dropdown);
}

.user-dropdown-header {
  padding: var(--space-4);
  background: rgba(44, 38, 34, 0.04);
}

.user-dropdown-name {
  display: block;
  font-weight: var(--font-semibold);
  color: #2C2622;
  margin-bottom: 2px;
}

.user-dropdown-email {
  display: block;
  font-size: var(--text-xs);
  color: #8A8078;
}

.user-dropdown-divider {
  height: 1px;
  background: rgba(44, 38, 34, 0.07);
}

.user-dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: 11px 14px;
  font-size: var(--text-sm);
  color: #4A4440;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background var(--transition-base), color var(--transition-base);
  text-decoration: none;
  text-align: left;
}

.user-dropdown-item:hover {
  background: rgba(44, 38, 34, 0.04);
  color: #2C2622;
}

.user-dropdown-item.logout:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #c03030;
}

.user-dropdown-item svg {
  color: #8A8078;
  flex-shrink: 0;
}

/* Dropdown animation */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

/* ============================================================
 * AUTH BUTTONS
 * ============================================================ */
.auth-btn {
  padding: 8px 16px;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  cursor: pointer;
  font-family: inherit;
  transition:
    transform var(--transition-base),
    box-shadow var(--transition-base),
    background var(--transition-base),
    border-color var(--transition-base);
}

.auth-btn--secondary {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.1);
  color: #4A4440;
}

.auth-btn--secondary:hover {
  border-color: rgba(44, 38, 34, 0.2);
  color: #2C2622;
}

.auth-btn--primary {
  background: linear-gradient(180deg, #d94545 0%, #a83232 100%);
  border: none;
  color: white;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    0 2px 6px rgba(194, 58, 58, 0.24);
}

.auth-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    0 4px 14px rgba(194, 58, 58, 0.34);
}

/* Auth Skeleton */
.auth-skeleton {
  width: 120px;
  height: 36px;
  background: linear-gradient(
    90deg,
    rgba(44, 38, 34, 0.04) 25%,
    rgba(44, 38, 34, 0.08) 50%,
    rgba(44, 38, 34, 0.04) 75%
  );
  background-size: 200% 100%;
  border-radius: var(--radius-full);
  animation: skeleton-shimmer 1.5s infinite;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ============================================================
 * MOBILE
 * ============================================================ */
.mobile-menu-btn {
  display: none;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(44, 38, 34, 0.08);
  color: #2C2622;
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: background var(--transition-base);
}

.mobile-menu-btn:hover {
  background: rgba(255, 255, 255, 0.85);
}

.mobile-menu-btn:focus-visible {
  outline: 2px solid rgba(194, 58, 58, 0.5);
  outline-offset: 2px;
}

.mobile-menu-panel {
  position: fixed;
  top: calc(var(--nav-height) + env(safe-area-inset-top, 0px));
  left: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.92);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  box-shadow: 0 12px 24px rgba(44, 38, 34, 0.08);
  z-index: calc(var(--z-nav) - 1);
  padding: var(--space-2) 0;
}

.mobile-menu-item {
  display: block;
  padding: 12px 24px;
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: #4A4440;
  text-decoration: none;
  transition: background var(--transition-base), color var(--transition-base);
}

.mobile-menu-item:hover {
  background: rgba(44, 38, 34, 0.05);
  color: #2C2622;
}

.mobile-menu-item.active {
  color: var(--ssi-red);
  font-weight: var(--font-semibold);
  background: rgba(194, 58, 58, 0.06);
}

.mobile-menu-learn {
  border-top: 1px solid rgba(44, 38, 34, 0.08);
  margin-top: var(--space-2);
  padding-top: 14px;
  color: var(--ssi-red);
  font-weight: var(--font-semibold);
}

.mobile-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-nav) - 2);
  background: rgba(26, 22, 20, 0.3);
}

.mobile-menu-enter-active,
.mobile-menu-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.mobile-menu-enter-from,
.mobile-menu-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ============================================================
 * UTILITIES
 * ============================================================ */
.mono {
  font-family: var(--font-mono);
}

/* ============================================================
 * RESPONSIVE
 * ============================================================ */
@media (max-width: 900px) {
  .school-badge-name {
    max-width: 120px;
  }
}

@media (max-width: 768px) {
  .mobile-menu-btn {
    display: flex;
  }

  .nav-tabs,
  .nav-tabs-spacer {
    display: none;
  }

  .school-badge,
  .chip-btn,
  .learn-btn,
  .auth-btn--secondary {
    display: none;
  }

  .auth-btn--primary {
    padding: 8px 14px;
    font-size: var(--text-xs);
  }

  .logo-build {
    display: none;
  }
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .nav-tab,
  .chip-btn,
  .learn-btn,
  .auth-btn,
  .user-menu,
  .mobile-menu-btn {
    transition: none;
  }
}
</style>
