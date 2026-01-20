<script setup lang="ts">
import { ref } from 'vue'
import { useDevRole, type DevRole } from '@/composables/useDevRole'

const { currentRole, currentUser, setRole } = useDevRole()

const isOpen = ref(false)

const roles: { value: DevRole; label: string; icon: string }[] = [
  { value: 'school_admin', label: 'School Admin', icon: '🏫' },
  { value: 'teacher', label: 'Teacher', icon: '👩‍🏫' },
  { value: 'student', label: 'Student', icon: '🎓' },
]

const selectRole = (role: DevRole) => {
  setRole(role)
  isOpen.value = false
  // Reload to apply role change across all components
  window.location.reload()
}
</script>

<template>
  <div class="dev-role-switcher" :class="{ open: isOpen }">
    <!-- Toggle Button -->
    <button class="switcher-toggle" @click="isOpen = !isOpen" title="Switch Role (Dev)">
      <span class="toggle-icon">🔧</span>
      <span class="toggle-label">DEV</span>
    </button>

    <!-- Panel -->
    <div class="switcher-panel" v-show="isOpen">
      <div class="panel-header">
        <h4>View As</h4>
        <span class="dev-badge">Development Only</span>
      </div>

      <div class="current-user">
        <div class="user-avatar">{{ currentUser.name.charAt(0) }}</div>
        <div class="user-info">
          <span class="user-name">{{ currentUser.name }}</span>
          <span class="user-email">{{ currentUser.email }}</span>
        </div>
      </div>

      <div class="role-options">
        <button
          v-for="role in roles"
          :key="role.value"
          class="role-option"
          :class="{ active: currentRole === role.value }"
          @click="selectRole(role.value)"
        >
          <span class="role-icon">{{ role.icon }}</span>
          <span class="role-label">{{ role.label }}</span>
          <span v-if="currentRole === role.value" class="check-icon">✓</span>
        </button>
      </div>

      <div class="panel-footer">
        <p>Switching roles will reload the page</p>
      </div>
    </div>

    <!-- Backdrop -->
    <div class="backdrop" v-show="isOpen" @click="isOpen = false" />
  </div>
</template>

<style scoped>
.dev-role-switcher {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  font-family: 'Source Sans 3', sans-serif;
}

.switcher-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  border: 2px solid #c23a3a;
  border-radius: 8px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(194, 58, 58, 0.3);
  transition: all 0.2s ease;
}

.switcher-toggle:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 25px rgba(194, 58, 58, 0.4);
}

.toggle-icon {
  font-size: 14px;
}

.toggle-label {
  letter-spacing: 1px;
}

.switcher-panel {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 12px;
  width: 280px;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: rgba(194, 58, 58, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.panel-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.dev-badge {
  font-size: 10px;
  padding: 4px 8px;
  background: rgba(194, 58, 58, 0.2);
  color: #c23a3a;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.current-user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.user-avatar {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #c23a3a, #d4a853);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
  color: #fff;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-name {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
}

.user-email {
  font-size: 12px;
  color: #888;
}

.role-options {
  padding: 8px;
}

.role-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #b0b0b0;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.role-option:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.role-option.active {
  background: rgba(194, 58, 58, 0.15);
  border-color: rgba(194, 58, 58, 0.3);
  color: #fff;
}

.role-icon {
  font-size: 18px;
}

.role-label {
  flex: 1;
}

.check-icon {
  color: #c23a3a;
  font-weight: bold;
}

.panel-footer {
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-footer p {
  margin: 0;
  font-size: 11px;
  color: #666;
  text-align: center;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
}

/* Animation */
.switcher-panel {
  animation: slideUp 0.2s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
