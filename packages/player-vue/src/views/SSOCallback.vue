<script setup lang="ts">
import { AuthenticateWithRedirectCallback } from '@clerk/vue'
</script>

<template>
  <div class="sso-callback">
    <AuthenticateWithRedirectCallback />
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Completing sign in...</p>
    </div>
  </div>
</template>

<style scoped>
.sso-callback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--color-background, #0a0a0f);
  color: var(--color-text, #e8e6e3);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: var(--color-accent, #6366f1);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

p {
  font-size: 0.9rem;
  opacity: 0.7;
}
</style>
