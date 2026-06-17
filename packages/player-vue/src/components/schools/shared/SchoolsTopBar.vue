<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolsDensity } from '@/composables/schools/useSchoolsDensity'
import DensityToggle from './DensityToggle.vue'

type NavTab = { label: string; to: string; routeName?: string }

const route = useRoute()
const router = useRouter()
const { currentUser, isGovtAdmin, isSchoolAdmin } = useSchoolContext()

const auth = inject<any>('auth', null)

const { density } = useSchoolsDensity()

// Density toggle only appears on the dashboard surface.
const showDensity = computed(() => route.name === 'schools-dashboard')

const tabs = computed<NavTab[]>(() => {
  if (isGovtAdmin.value) {
    return [
      { label: 'Schools',   to: '/schools/all',       routeName: 'schools' },
      { label: 'Analytics', to: '/schools/analytics', routeName: 'analytics' },
    ]
  }
  if (isSchoolAdmin.value) {
    return [
      { label: 'Dashboard', to: '/schools',           routeName: 'schools-dashboard' },
      { label: 'Classes',   to: '/schools/classes',   routeName: 'classes' },
      { label: 'Students',  to: '/schools/students',  routeName: 'students' },
      { label: 'Teachers',  to: '/schools/teachers',  routeName: 'teachers' },
      { label: 'Analytics', to: '/schools/analytics', routeName: 'analytics' },
      { label: 'Settings',  to: '/schools/settings',  routeName: 'settings' },
      { label: 'Upgrade',   to: '/schools/upgrade',   routeName: 'schools-upgrade' },
    ]
  }
  // Teacher (default)
  return [
    { label: 'Dashboard', to: '/schools',           routeName: 'schools-dashboard' },
    { label: 'Students',  to: '/schools/students',  routeName: 'students' },
    { label: 'Analytics', to: '/schools/analytics', routeName: 'analytics' },
  ]
})

function isActive(tab: NavTab): boolean {
  if (tab.routeName && route.name === tab.routeName) return true
  // /schools/classes/:id should keep "Classes" tab highlighted
  if (tab.to === '/schools/classes' && route.path.startsWith('/schools/classes')) return true
  return false
}

const displayName = computed(() => currentUser.value?.display_name || 'You')
const initials = computed(() =>
  displayName.value.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'SS',
)
const roleLabel = computed(() => {
  if (isGovtAdmin.value) return 'Govt Admin'
  if (isSchoolAdmin.value) return 'School Admin'
  return 'Teacher'
})
const roleAvatarColor = computed(() => {
  if (isGovtAdmin.value) return 'var(--schools-role-govt)'
  if (isSchoolAdmin.value) return 'var(--schools-role-admin)'
  return 'var(--schools-role-teacher)'
})
const schoolLabel = computed(() => currentUser.value?.school_name || '')

// User menu
const menuOpen = ref(false)
function toggleMenu() { menuOpen.value = !menuOpen.value }
function closeMenu() { menuOpen.value = false }

async function signOut() {
  closeMenu()
  try {
    await auth?.signOut?.()
  } catch (err) {
    console.error('[SchoolsTopBar] sign-out failed', err)
  }
  router.push('/schools')
}

// click-outside
function onDocClick(e: MouseEvent) {
  const root = document.querySelector('.schools-topbar')
  if (root && !root.contains(e.target as Node)) closeMenu()
}
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', onDocClick)
}
</script>

<template>
  <header class="schools-topbar">
    <div class="left">
      <router-link to="/schools" class="brand">
        <span class="brand-mark">S</span>
        <span class="brand-text">
          SaySomethingin <span class="brand-dot">·</span> <span class="brand-tail">Schools</span>
        </span>
      </router-link>

      <nav class="tabs" aria-label="Schools sections">
        <router-link
          v-for="t in tabs"
          :key="t.to"
          :to="t.to"
          :class="['tab', { active: isActive(t) }]"
        >
          {{ t.label }}
        </router-link>
      </nav>
    </div>

    <div class="right">
      <template v-if="showDensity">
        <DensityToggle v-model="density" />
        <span class="divider" />
      </template>

      <span v-if="schoolLabel" class="school-label">{{ schoolLabel }}</span>

      <div class="user-menu">
        <button type="button" class="user-trigger" @click="toggleMenu">
          <span class="avatar" :style="{ background: roleAvatarColor }">{{ initials }}</span>
          <span class="identity">
            <span class="identity-name">{{ displayName }}</span>
            <span class="identity-role">{{ roleLabel }}</span>
          </span>
          <span class="caret">▾</span>
        </button>
        <div v-if="menuOpen" class="user-menu-pop">
          <button type="button" class="menu-item" @click="signOut">Sign out</button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.schools-topbar {
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid var(--schools-border);
  flex: none;
  font-family: var(--font-body);
}

.left { display: flex; align-items: center; gap: 32px; min-width: 0; }
.right { display: flex; align-items: center; gap: 12px; }

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: inherit;
  flex: none;
}
.brand-mark {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--schools-red);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-weight: 400;
  font-size: 15px;
  line-height: 1;
}
.brand-text {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 1;
  color: var(--schools-fg);
}
.brand-dot { opacity: 0.5; }
.brand-tail { color: var(--schools-red); }

.tabs {
  display: flex;
  gap: 4px;
  align-items: center;
}
.tab {
  padding: 8px 14px;
  font-size: 13.5px;
  font-weight: 500;
  text-decoration: none;
  color: var(--schools-fg);
  background: transparent;
  border-radius: 6px;
  white-space: nowrap;
  transition: background 120ms ease-out, color 120ms ease-out;
}
.tab:hover { background: #f6f5f1; }
.tab.active {
  color: #fff;
  background: var(--schools-red);
}
.tab.active:hover { background: var(--schools-red-deep); }

.divider {
  width: 1px;
  height: 24px;
  background: var(--schools-border);
}

.school-label {
  font-size: 12.5px;
  color: var(--schools-fg-2);
}

.user-menu { position: relative; }
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px 5px 5px;
  border: 1px solid var(--schools-border);
  background: #fff;
  border-radius: 30px;
  cursor: pointer;
  font-family: var(--font-body);
}
.user-trigger:hover { border-color: var(--schools-border-strong); }

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex: none;
}

.identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
  gap: 1px;
  min-width: 0;
  max-width: 140px;
}
.identity-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--schools-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.identity-role {
  font-size: 10.5px;
  color: var(--schools-fg-2);
  white-space: nowrap;
}
.caret { font-size: 10px; color: var(--schools-fg-3); margin-right: 4px; }

.user-menu-pop {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 160px;
  z-index: 50;
  background: #fff;
  border: 1px solid var(--schools-border);
  border-radius: 10px;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}
.menu-item {
  display: block;
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--schools-fg);
  text-align: left;
  background: #fff;
  border: none;
  cursor: pointer;
  font-family: var(--font-body);
}
.menu-item:hover { background: #fafaf6; }

@media (max-width: 768px) {
  .tabs { display: none; }
  .school-label { display: none; }
  .schools-topbar { padding: 0 16px; }
}
</style>
