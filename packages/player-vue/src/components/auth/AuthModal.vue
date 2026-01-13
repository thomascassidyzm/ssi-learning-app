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
        <!-- Floating orbs -->
        <div class="orb orb-1" aria-hidden="true"></div>
        <div class="orb orb-2" aria-hidden="true"></div>
        <div class="orb orb-3" aria-hidden="true"></div>

        <!-- Modal container -->
        <div ref="modalRef" class="auth-modal" role="dialog" aria-modal="true">
          <!-- Decorative ring -->
          <div class="modal-ring" aria-hidden="true"></div>

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
}

/* Floating orbs - celestial atmosphere */
.orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(60px);
  opacity: 0.4;
}

.orb-1 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, var(--ssi-red) 0%, transparent 70%);
  top: 10%;
  left: 10%;
  animation: orb-float 15s ease-in-out infinite;
}

.orb-2 {
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, var(--ssi-gold) 0%, transparent 70%);
  bottom: 20%;
  right: 15%;
  animation: orb-float 12s ease-in-out infinite reverse;
}

.orb-3 {
  width: 150px;
  height: 150px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 70%);
  top: 50%;
  right: 30%;
  animation: orb-float 18s ease-in-out infinite;
}

@keyframes orb-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.1); }
  66% { transform: translate(-20px, 30px) scale(0.95); }
}

/* Modal card */
.auth-modal {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: linear-gradient(
    145deg,
    rgba(30, 30, 35, 0.95) 0%,
    rgba(20, 20, 25, 0.98) 100%
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

/* Decorative ring */
.modal-ring {
  position: absolute;
  top: -2px;
  left: -2px;
  right: -2px;
  bottom: -2px;
  border-radius: 26px;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    var(--ssi-red) 60deg,
    var(--ssi-gold) 120deg,
    transparent 180deg,
    var(--ssi-red) 240deg,
    var(--ssi-gold) 300deg,
    transparent 360deg
  );
  opacity: 0.3;
  z-index: -1;
  animation: ring-rotate 20s linear infinite;
}

@keyframes ring-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
  .orb,
  .modal-ring {
    animation: none;
  }

  .auth-modal {
    animation: none;
  }
}
</style>
