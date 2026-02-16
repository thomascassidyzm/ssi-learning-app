<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDevRole, type DevRole, type DevTier, PERSONAS } from '@/composables/useDevRole'
import { BELTS, getBeltIndexForSeed } from '@/composables/useBeltProgress'

const {
  currentRole, currentTier, devSeedOverride, currentUser,
  setRole, setTier, setSeedOverride, applyPersona,
} = useDevRole()

const isOpen = ref(false)
const seedInput = ref<number | null>(devSeedOverride.value)

const roles: { value: DevRole; label: string; icon: string }[] = [
  { value: 'school_admin', label: 'School Admin', icon: '🏫' },
  { value: 'teacher', label: 'Teacher', icon: '👩‍🏫' },
  { value: 'student', label: 'Student', icon: '🎓' },
]

const tiers: { value: DevTier; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
  { value: 'community', label: 'Community' },
]

const beltForSeed = computed(() => {
  if (seedInput.value === null || seedInput.value < 1) return null
  const idx = getBeltIndexForSeed(seedInput.value)
  return BELTS[idx]
})

const selectRole = (role: DevRole) => {
  setRole(role)
}

const selectTier = (tier: DevTier) => {
  setTier(tier)
}

const handleJump = () => {
  if (seedInput.value === null || seedInput.value < 1) return
  setSeedOverride(seedInput.value)
  window.dispatchEvent(new CustomEvent('ssi-jump-to-seed', {
    detail: { seedNumber: seedInput.value },
  }))
  isOpen.value = false
}

const handlePersona = (persona: typeof PERSONAS[0]) => {
  applyPersona(persona)
  seedInput.value = persona.seedOverride
  if (persona.seedOverride) {
    window.dispatchEvent(new CustomEvent('ssi-jump-to-seed', {
      detail: { seedNumber: persona.seedOverride },
    }))
  }
  isOpen.value = false
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
        <h4>God Mode</h4>
        <span class="dev-badge">Development Only</span>
      </div>

      <div class="current-user">
        <div class="user-avatar">{{ currentUser.name.charAt(0) }}</div>
        <div class="user-info">
          <span class="user-name">{{ currentUser.name }}</span>
          <span class="user-email">{{ currentUser.email }}</span>
        </div>
      </div>

      <!-- Role Selector -->
      <div class="section">
        <div class="section-label">Role</div>
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
      </div>

      <!-- Tier Selector -->
      <div class="section">
        <div class="section-label">Subscription Tier</div>
        <div class="tier-options">
          <button
            v-for="tier in tiers"
            :key="tier.value"
            class="tier-option"
            :class="{ active: currentTier === tier.value }"
            @click="selectTier(tier.value)"
          >
            {{ tier.label }}
          </button>
        </div>
      </div>

      <!-- Jump to Seed -->
      <div class="section">
        <div class="section-label">Jump to Seed</div>
        <div class="seed-jump">
          <input
            v-model.number="seedInput"
            type="number"
            min="1"
            max="668"
            placeholder="Seed #"
            class="seed-input"
            @keydown.enter="handleJump"
          />
          <span v-if="beltForSeed" class="belt-badge" :style="{ background: beltForSeed.color, color: '#000' }">
            {{ beltForSeed.name }}
          </span>
          <button class="jump-btn" @click="handleJump" :disabled="!seedInput || seedInput < 1">
            Jump
          </button>
        </div>
      </div>

      <!-- Personas -->
      <div class="section">
        <div class="section-label">Personas</div>
        <div class="persona-grid">
          <button
            v-for="persona in PERSONAS"
            :key="persona.name"
            class="persona-btn"
            @click="handlePersona(persona)"
          >
            <span class="persona-name">{{ persona.name }}</span>
            <span class="persona-detail">{{ persona.tier }}{{ persona.seedOverride ? ` · S${persona.seedOverride}` : '' }}</span>
          </button>
        </div>
      </div>

      <div class="panel-footer">
        <p>Changes apply instantly (no reload needed for tier/jump)</p>
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
  border: 2px solid var(--ssi-red);
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

.toggle-icon { font-size: 14px; }
.toggle-label { letter-spacing: 1px; }

.switcher-panel {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 12px;
  width: 320px;
  max-height: 80vh;
  overflow-y: auto;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.2s ease;
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
  color: var(--ssi-red);
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
  background: linear-gradient(135deg, var(--ssi-red), #d4a853);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
  color: #fff;
  flex-shrink: 0;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-name { font-size: 14px; font-weight: 600; color: #fff; }
.user-email { font-size: 12px; color: #888; overflow: hidden; text-overflow: ellipsis; }

/* Sections */
.section {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

/* Roles */
.role-options { display: flex; flex-direction: column; gap: 4px; }

.role-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
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

.role-option:hover { background: rgba(255, 255, 255, 0.05); color: #fff; }
.role-option.active { background: rgba(194, 58, 58, 0.15); border-color: rgba(194, 58, 58, 0.3); color: #fff; }

.role-icon { font-size: 18px; }
.role-label { flex: 1; }
.check-icon { color: var(--ssi-red); font-weight: bold; }

/* Tiers */
.tier-options { display: flex; gap: 6px; }

.tier-option {
  flex: 1;
  padding: 8px 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #b0b0b0;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
}

.tier-option:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.tier-option.active { background: rgba(194, 58, 58, 0.2); border-color: var(--ssi-red); color: #fff; }

/* Seed Jump */
.seed-jump { display: flex; align-items: center; gap: 8px; }

.seed-input {
  width: 80px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  outline: none;
}

.seed-input:focus { border-color: var(--ssi-red); }
.seed-input::placeholder { color: #555; }

/* Hide number input spinners */
.seed-input::-webkit-outer-spin-button,
.seed-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.seed-input[type=number] { -moz-appearance: textfield; }

.belt-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
  text-transform: capitalize;
  white-space: nowrap;
}

.jump-btn {
  padding: 8px 14px;
  background: var(--ssi-red);
  border: none;
  border-radius: 6px;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.jump-btn:hover:not(:disabled) { background: #d44; }
.jump-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Personas */
.persona-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

.persona-btn {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: #ccc;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.persona-btn:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.15); color: #fff; }

.persona-name { font-size: 12px; font-weight: 600; }
.persona-detail { font-size: 10px; color: #777; margin-top: 2px; }

/* Footer */
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

@keyframes slideUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
