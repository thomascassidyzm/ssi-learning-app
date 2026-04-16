<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const status = ref('validating') // 'validating' | 'valid' | 'error'
const errorMessage = ref('')
const label = ref('')

onMounted(async () => {
  const code = route.params.code

  if (!code) {
    status.value = 'error'
    errorMessage.value = 'No try link code provided'
    return
  }

  try {
    const response = await fetch('/api/try-link/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      status.value = 'error'
      errorMessage.value = data.error || 'This link is no longer valid'
      return
    }

    const data = await response.json()
    label.value = data.label || ''
    status.value = 'valid'

    // Grant full course access for this browser session
    sessionStorage.setItem('ssi-demo-tier', 'paid')
    sessionStorage.setItem('ssi-try-link', code)

    // Brief pause so the user sees the welcome, then redirect
    setTimeout(() => {
      window.location.href = '/'
    }, 1200)
  } catch (err) {
    status.value = 'error'
    errorMessage.value = 'Something went wrong. Please try again.'
  }
})
</script>

<template>
  <div class="try-gateway">
    <div class="try-card">
      <!-- Validating -->
      <template v-if="status === 'validating'">
        <div class="spinner" />
        <p class="message">Checking your link...</p>
      </template>

      <!-- Valid — redirecting -->
      <template v-else-if="status === 'valid'">
        <div class="check-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 class="title">Welcome to SaySomethingin</h2>
        <p class="subtitle" v-if="label">{{ label }}</p>
        <p class="message">Loading your courses...</p>
      </template>

      <!-- Error -->
      <template v-else-if="status === 'error'">
        <div class="error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h2 class="title">Link not valid</h2>
        <p class="message">{{ errorMessage }}</p>
        <a href="https://www.saysomethingin.com" class="home-link">Visit SaySomethingin</a>
      </template>
    </div>
  </div>
</template>

<style scoped>
.try-gateway {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary, #f5f0eb);
  padding: 1rem;
}

.try-card {
  text-align: center;
  max-width: 400px;
  padding: 2.5rem 2rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-subtle, rgba(0, 0, 0, 0.1));
  border-top-color: var(--text-primary, #1a1a1a);
  border-radius: 50%;
  margin: 0 auto 1.5rem;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.check-icon {
  color: #22c55e;
  margin-bottom: 1rem;
}

.error-icon {
  color: #ef4444;
  margin-bottom: 1rem;
}

.title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary, #1a1a1a);
  margin: 0 0 0.5rem;
}

.subtitle {
  font-size: 0.95rem;
  color: var(--text-secondary, #666);
  margin: 0 0 0.75rem;
}

.message {
  font-size: 0.9rem;
  color: var(--text-muted, #999);
  margin: 0;
}

.home-link {
  display: inline-block;
  margin-top: 1.5rem;
  padding: 0.6rem 1.5rem;
  background: var(--text-primary, #1a1a1a);
  color: var(--bg-primary, #fff);
  border-radius: 8px;
  text-decoration: none;
  font-size: 0.9rem;
  transition: opacity 0.2s;
}

.home-link:hover {
  opacity: 0.85;
}
</style>
