<script setup>
/**
 * AuthPrompt - Soft signup prompt shown after first session for guests
 *
 * Appears in SessionComplete to encourage users to save their progress
 */

const emit = defineEmits(['signup', 'dismiss'])
</script>

<template>
  <div class="auth-prompt">
    <div class="prompt-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </div>

    <div class="prompt-content">
      <h3 class="prompt-title">Save your progress</h3>
      <p class="prompt-description">
        Create a free account to keep your learning history and continue on any device.
      </p>
    </div>

    <div class="prompt-actions">
      <button class="btn-primary" @click="emit('signup')">
        Create account
      </button>
      <button class="btn-secondary" @click="emit('dismiss')">
        Maybe later
      </button>
    </div>
  </div>
</template>

<style scoped>
.auth-prompt {
  background: var(--bg-card, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  border-radius: 16px;
  padding: 1.25rem;
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1rem;
}

.prompt-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--accent-glow, rgba(194, 58, 58, 0.4));
  display: flex;
  align-items: center;
  justify-content: center;
}

.prompt-icon svg {
  width: 24px;
  height: 24px;
  color: var(--accent, #c23a3a);
}

.prompt-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.prompt-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary, #ffffff);
  margin: 0;
}

.prompt-description {
  font-size: 0.875rem;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  margin: 0;
  line-height: 1.5;
}

.prompt-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 200px;
}

.btn-primary {
  background: var(--gradient-accent, linear-gradient(145deg, #d44545 0%, #b83232 100%));
  color: white;
  border: none;
  border-radius: 12px;
  padding: 0.75rem 1.5rem;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: var(--glow-accent, 0 4px 16px rgba(194, 58, 58, 0.35));
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(194, 58, 58, 0.45);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-secondary {
  background: transparent;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  border: none;
  border-radius: 12px;
  padding: 0.5rem 1rem;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s ease;
}

.btn-secondary:hover {
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
}
</style>
