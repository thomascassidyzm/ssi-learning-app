<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import TopNav from '@/components/schools/shared/TopNav.vue'
import GodModePanel from '@/components/schools/GodModePanel.vue'
import { SignInModal } from '@/components/auth'
import { useAuthModal } from '@/composables/useAuthModal'
import { setSchoolsClient } from '@/composables/schools/client'

// Supabase client from App
const supabase = inject('supabase', ref(null)) as any

// Set client immediately during setup (before child components call useGodMode)
if (supabase.value) {
  setSchoolsClient(supabase.value)
}

// Global auth modal (shared singleton - same state as PlayerContainer)
const { open: openAuth, close: closeAuth } = useAuthModal()

const handleAuthSuccess = () => {
  console.log('Auth successful!')
  closeAuth()
}
</script>

<template>
  <div class="schools-container">
    <TopNav @sign-in="openAuth" @sign-up="openAuth" />

    <!-- God Mode Panel (replaces DevRoleSwitcher) -->
    <GodModePanel />

    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- Unified Auth Modal (shared state across app) -->
    <SignInModal @success="handleAuthSuccess" />
  </div>
</template>

<style scoped>
.schools-container {
  height: 100vh;
  position: relative;
  background: var(--bg-primary);
  overflow-y: auto;
}

.main-content {
  margin-top: 64px;
  min-height: calc(100vh - 64px);
  position: relative;
  z-index: 10;
  padding: 32px;
  max-width: 1400px;
  margin-left: auto;
  margin-right: auto;
}

/* Page transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .main-content {
    padding: 16px;
  }
}

</style>
