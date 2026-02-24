<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import { setSchoolsClient } from '@/composables/schools/client'

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
}

.admin-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #e8e8f0);
  letter-spacing: 0.02em;
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
