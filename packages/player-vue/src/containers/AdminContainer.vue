<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { setSchoolsClient } from '@/composables/schools/client'

const route = useRoute()

// Supabase client from App
const supabase = inject('supabase', ref(null)) as any

// Set up client bridge so admin composables can access Supabase
onMounted(() => {
  if (supabase.value) {
    setSchoolsClient(supabase.value)
  }
})
</script>

<template>
  <div class="admin-container">
    <header class="admin-header">
      <h1 class="admin-title">SSi Admin</h1>
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
      </nav>
    </header>
    <main class="admin-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.admin-container {
  min-height: 100vh;
  background: var(--bg-primary, #0a0a1a);
  color: var(--text-primary, #e8e8f0);
}

.admin-header {
  padding: 20px 32px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.admin-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #e8e8f0);
  letter-spacing: 0.02em;
}

.admin-nav {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.04);
  padding: 4px;
  border-radius: 8px;
}

.nav-link {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary, #a0a0b8);
  text-decoration: none;
  transition: all 0.15s;
}

.nav-link:hover {
  color: var(--text-primary, #e8e8f0);
}

.nav-link.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e8e8f0);
}

.admin-main {
  padding: 32px;
  max-width: 1200px;
  margin: 0 auto;
}

@media (max-width: 768px) {
  .admin-header {
    padding: 16px 20px;
  }

  .admin-main {
    padding: 20px;
  }
}
</style>
