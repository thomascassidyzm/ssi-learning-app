<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'

interface Props {
  isOpen: boolean
  title?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: ''
})

const emit = defineEmits<{
  close: []
}>()

const modalRef = ref<HTMLElement | null>(null)

// Close on escape
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.isOpen) {
    emit('close')
  }
}

// Close on backdrop click
const handleBackdropClick = (e: MouseEvent) => {
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

// Lock body scroll when modal is open
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="auth-modal-backdrop" @click="handleBackdropClick">
        <!-- Modal container -->
        <div ref="modalRef" class="auth-modal" role="dialog" aria-modal="true">
          <!-- Close button -->
          <button class="modal-close" @click="emit('close')" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>

          <!-- Logo -->
          <div class="modal-logo">
            <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
          </div>

          <!-- Title -->
          <h2 v-if="title" class="modal-title">{{ title }}</h2>

          <!-- Content slot -->
          <div class="modal-content">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.auth-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 1rem;
  /* iOS safe areas */
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
  /* Allow scrolling on mobile when modal is tall */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* Modal card */
.auth-modal {
  position: relative;
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: linear-gradient(
    145deg,
    rgba(45, 45, 52, 0.98) 0%,
    rgba(35, 35, 42, 0.99) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  padding: 2.5rem;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.05),
    0 25px 80px rgba(0, 0, 0, 0.5),
    0 0 60px rgba(194, 58, 58, 0.15);
  animation: modal-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Mobile adjustments */
@media (max-width: 480px) {
  .auth-modal {
    padding: 1.5rem;
    border-radius: 20px;
    margin: 0.5rem;
  }
}

@media (max-height: 700px) {
  .auth-modal {
    padding: 1.25rem;
  }
}

@keyframes modal-enter {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Close button */
.modal-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close svg {
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.modal-close:hover svg {
  color: var(--text-primary);
}

/* Logo */
.modal-logo {
  text-align: center;
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  letter-spacing: -0.02em;
}

.logo-say, .logo-in {
  color: var(--ssi-red);
}

.logo-something {
  color: var(--text-primary);
}

/* Title */
.modal-title {
  text-align: center;
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 2rem;
}

/* Content */
.modal-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Modal transitions */
.modal-enter-active {
  transition: opacity 0.3s ease;
}

.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .auth-modal,
.modal-leave-to .auth-modal {
  transform: translateY(20px) scale(0.95);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .auth-modal {
    animation: none;
  }
}
</style>
