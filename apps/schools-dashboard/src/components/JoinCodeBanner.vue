<script setup lang="ts">
import { ref, computed } from 'vue'

interface Props {
  code: string
  label?: string
  description?: string
  variant?: 'teacher' | 'student'
  showHelp?: boolean
  canRegenerate?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: 'Join Code',
  description: 'Share this code to invite users',
  variant: 'teacher',
  showHelp: true,
  canRegenerate: false
})

const emit = defineEmits<{
  (e: 'copy'): void
  (e: 'share'): void
  (e: 'regenerate'): void
}>()

const copied = ref(false)
const showHelpTooltip = ref(false)

const variantConfig = computed(() => ({
  teacher: {
    icon: 'key',
    accentColor: 'var(--ssi-red)',
    bgGradient: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(194, 58, 58, 0.12) 100%)',
    borderColor: 'rgba(194, 58, 58, 0.35)'
  },
  student: {
    icon: 'users',
    accentColor: 'var(--ssi-gold)',
    bgGradient: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(212, 168, 83, 0.12) 100%)',
    borderColor: 'rgba(212, 168, 83, 0.35)'
  }
}[props.variant]))

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    emit('copy')
    setTimeout(() => {
      copied.value = false
    }, 2200)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

async function shareCode() {
  if (navigator.share) {
    try {
      await navigator.share({
        title: `${props.label}`,
        text: `Join with code: ${props.code}`,
        url: window.location.origin
      })
      emit('share')
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Share failed:', err)
      }
    }
  } else {
    copyCode()
  }
}

function handleRegenerate() {
  emit('regenerate')
}
</script>

<template>
  <div
    class="join-code-banner"
    :style="{
      background: variantConfig.bgGradient,
      borderColor: variantConfig.borderColor
    }"
  >
    <!-- Left: Info Section -->
    <div class="banner-info">
      <h3 class="banner-title">
        <span class="title-icon" :style="{ color: variantConfig.accentColor }">
          <!-- Key icon for teacher, users for student -->
          <svg v-if="variant === 'teacher'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </span>
        {{ label }}
      </h3>
      <p class="banner-description">{{ description }}</p>

      <!-- Help tooltip -->
      <button
        v-if="showHelp"
        class="help-trigger"
        @mouseenter="showHelpTooltip = true"
        @mouseleave="showHelpTooltip = false"
        @focus="showHelpTooltip = true"
        @blur="showHelpTooltip = false"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        How it works

        <Transition name="tooltip">
          <div v-if="showHelpTooltip" class="help-tooltip">
            <div class="tooltip-arrow"></div>
            <p v-if="variant === 'teacher'">
              <strong>Share this code with teachers</strong> who want to join your school.
              They'll enter it during signup or in their settings.
            </p>
            <p v-else>
              <strong>Share this code with students</strong> who should join this class.
              They can enter it in the app to connect.
            </p>
          </div>
        </Transition>
      </button>
    </div>

    <!-- Right: Code Display & Actions -->
    <div class="banner-actions">
      <div
        class="code-display"
        :style="{ borderColor: variantConfig.accentColor }"
      >
        <span
          class="code-text"
          :style="{ color: variantConfig.accentColor }"
        >{{ code }}</span>
      </div>

      <div class="action-buttons">
        <button
          class="action-btn copy-btn"
          :class="{ copied }"
          @click="copyCode"
        >
          <svg v-if="!copied" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {{ copied ? 'Copied!' : 'Copy' }}
        </button>

        <button
          class="action-btn share-btn"
          @click="shareCode"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          Share
        </button>

        <button
          v-if="canRegenerate"
          class="action-btn regenerate-btn"
          @click="handleRegenerate"
          title="Generate a new code"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.join-code-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 32px;
  border: 1.5px solid;
  border-radius: 20px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}

.join-code-banner::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--ssi-red), var(--ssi-gold));
  opacity: 0.6;
}

.join-code-banner:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

/* Info Section */
.banner-info {
  flex: 1;
  min-width: 0;
}

.banner-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Noto Sans JP', system-ui, sans-serif;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.title-icon {
  display: flex;
  align-items: center;
}

.banner-description {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 12px;
}

.help-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.help-trigger:hover {
  color: var(--text-secondary);
  border-color: var(--border-medium);
}

.help-tooltip {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  width: 280px;
  padding: 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  z-index: 100;
}

.help-tooltip p {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
}

.help-tooltip strong {
  color: var(--text-primary);
  display: block;
  margin-bottom: 4px;
}

.tooltip-arrow {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 12px;
  height: 12px;
  background: var(--bg-elevated);
  border-right: 1px solid var(--border-medium);
  border-bottom: 1px solid var(--border-medium);
}

/* Tooltip animation */
.tooltip-enter-active,
.tooltip-leave-active {
  transition: all 0.2s ease;
}

.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* Code Display */
.banner-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.code-display {
  background: var(--bg-primary);
  border: 2.5px solid;
  border-radius: 14px;
  padding: 14px 28px;
  position: relative;
}

.code-display::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 50%);
  pointer-events: none;
}

.code-text {
  font-family: 'Noto Sans JP', 'JetBrains Mono', monospace;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 5px;
  user-select: all;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: 12px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: var(--ssi-red);
  border-color: var(--ssi-red);
  color: white;
  transform: translateY(-2px);
}

.action-btn.copy-btn.copied {
  background: var(--success);
  border-color: var(--success);
  color: white;
}

.regenerate-btn {
  padding: 12px;
}

.regenerate-btn:hover {
  background: var(--ssi-gold);
  border-color: var(--ssi-gold);
  color: #1a1a1a;
}

/* Responsive */
@media (max-width: 900px) {
  .join-code-banner {
    flex-direction: column;
    text-align: center;
    padding: 24px;
  }

  .banner-info {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .help-trigger {
    margin-bottom: 16px;
  }

  .help-tooltip {
    left: 50%;
  }

  .banner-actions {
    flex-direction: column;
    width: 100%;
    gap: 12px;
  }

  .code-display {
    width: 100%;
    text-align: center;
  }

  .action-buttons {
    justify-content: center;
  }
}

@media (max-width: 480px) {
  .code-text {
    font-size: 24px;
    letter-spacing: 4px;
  }

  .action-btn {
    padding: 10px 14px;
    font-size: 13px;
  }
}
</style>
