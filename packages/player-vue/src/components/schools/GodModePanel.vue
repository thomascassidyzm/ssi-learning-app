<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGodMode, type EducationalRole, type GodModeUser } from '@/composables/schools/useGodMode'
import AddEntityModal from './AddEntityModal.vue'

const router = useRouter()

const {
  selectedUser,
  allUsers,
  isLoading,
  error,
  isGodAccessVerified,
  usersByRole,
  checkGodAccess,
  fetchUsers,
  selectUser,
  clearSelection,
  searchUsers,
} = useGodMode()

// Add entity modal state
type EntityType = 'govt_admin' | 'school' | 'teacher' | 'student'
const showAddModal = ref(false)
const addEntityType = ref<EntityType>('student')

function openAddModal(type: EntityType) {
  addEntityType.value = type
  showAddModal.value = true
}

function handleEntityCreated(entity: any) {
  console.log('Entity created:', entity)
  // Refresh users list
  fetchUsers()
}

const isOpen = ref(false)
const searchQuery = ref('')
const roleFilter = ref<EducationalRole | null>(null)

const roles: { value: EducationalRole; label: string; icon: string }[] = [
  { value: 'govt_admin', label: 'Govt Admin', icon: '🏛️' },
  { value: 'school_admin', label: 'School Admin', icon: '🏫' },
  { value: 'teacher', label: 'Teacher', icon: '👩‍🏫' },
  { value: 'student', label: 'Student', icon: '🎓' },
]

const filteredUsers = computed(() => {
  return searchUsers(searchQuery.value, roleFilter.value || undefined)
})

const quickSelectUsers = computed(() => {
  // Return first user of each role for quick selection
  return roles.map(role => ({
    role,
    user: usersByRole.value[role.value][0],
  })).filter(item => item.user)
})

function handleSelectUser(user: GodModeUser) {
  selectUser(user)
  isOpen.value = false
  // Full reload at /schools: ssi_admins hitting /schools get redirected to
  // /admin/schools by the route guard, so staying on the current URL after
  // impersonation (via router.go(0)) lands them back in admin-setup rather
  // than in the impersonated teacher/school_admin/govt_admin dashboard.
  // Jumping explicitly to /schools reloads the app with the impersonated
  // role active — the guard now sees a school-scoped role and passes.
  window.location.href = '/schools'
}

function handleClear() {
  clearSelection()
  // Back to the real user's landing — /admin/schools for ssi_admins,
  // /schools for actual school-role users.
  window.location.href = '/schools'
}

function setRoleFilter(role: EducationalRole | null) {
  roleFilter.value = roleFilter.value === role ? null : role
}

function getRoleIcon(role: EducationalRole | null): string {
  return roles.find(r => r.value === role)?.icon || '👤'
}

function getRoleLabel(role: EducationalRole | null): string {
  return roles.find(r => r.value === role)?.label || 'Unknown'
}

onMounted(async () => {
  const hasAccess = await checkGodAccess()
  if (hasAccess) {
    fetchUsers()
  }
})
</script>

<template>
  <div v-if="isGodAccessVerified" class="god-mode-panel" :class="{ open: isOpen }">
    <!-- Floating trigger (matches TesterFeedback FAB; stacked above it) -->
    <button
      class="god-fab"
      :aria-label="selectedUser ? `GOD mode — impersonating ${selectedUser.display_name}` : 'GOD mode — impersonate a user'"
      title="GOD mode"
      @click="isOpen = !isOpen"
    >
      <span class="god-fab-icon" aria-hidden="true">👁️</span>
      <span v-if="selectedUser" class="god-fab-dot" aria-hidden="true" />
    </button>

    <!-- Panel -->
    <div class="panel-content" v-show="isOpen">
      <div class="panel-header">
        <h4>God Mode</h4>
        <span class="dev-badge">Testing Only</span>
      </div>

      <!-- Current User -->
      <div class="current-user" v-if="selectedUser">
        <div class="user-avatar">{{ getRoleIcon(selectedUser.educational_role) }}</div>
        <div class="user-info">
          <span class="user-name">{{ selectedUser.display_name }}</span>
          <span class="user-role">{{ getRoleLabel(selectedUser.educational_role) }}</span>
          <span class="user-context" v-if="selectedUser.school_name">
            {{ selectedUser.school_name }}
          </span>
          <span class="user-context" v-else-if="selectedUser.organization_name">
            {{ selectedUser.organization_name }}
          </span>
        </div>
        <button class="clear-btn" @click="handleClear" title="Clear selection">×</button>
      </div>
      <div class="no-user" v-else>
        <span>No user selected</span>
      </div>

      <!-- Quick Select -->
      <div class="quick-select" v-if="quickSelectUsers.length > 0">
        <div class="section-label">Quick Select</div>
        <div class="quick-buttons">
          <button
            v-for="item in quickSelectUsers"
            :key="item.role.value"
            class="quick-btn"
            :class="{ active: selectedUser?.educational_role === item.role.value }"
            @click="handleSelectUser(item.user)"
          >
            <span class="btn-icon">{{ item.role.icon }}</span>
            <span class="btn-label">{{ item.role.label }}</span>
          </button>
        </div>
      </div>

      <!-- Search -->
      <div class="search-section">
        <input
          type="text"
          v-model="searchQuery"
          placeholder="Search users..."
          class="search-input"
        />
      </div>

      <!-- Role Filter -->
      <div class="role-filters">
        <button
          v-for="role in roles"
          :key="role.value"
          class="filter-btn"
          :class="{ active: roleFilter === role.value }"
          @click="setRoleFilter(role.value)"
        >
          {{ role.icon }} {{ usersByRole[role.value].length }}
        </button>
      </div>

      <!-- User List -->
      <div class="user-list" v-if="!isLoading">
        <div
          v-for="user in filteredUsers.slice(0, 50)"
          :key="user.user_id"
          class="user-item"
          :class="{ selected: selectedUser?.user_id === user.user_id }"
          @click="handleSelectUser(user)"
        >
          <span class="item-icon">{{ getRoleIcon(user.educational_role) }}</span>
          <div class="item-info">
            <span class="item-name">{{ user.display_name }}</span>
            <span class="item-context">{{ user.school_name || user.organization_name || user.user_id }}</span>
          </div>
        </div>
        <div class="list-info" v-if="filteredUsers.length > 50">
          Showing 50 of {{ filteredUsers.length }} users
        </div>
      </div>
      <div class="loading" v-else>
        Loading users...
      </div>

      <!-- Error -->
      <div class="error" v-if="error">
        {{ error }}
      </div>

      <div class="panel-footer">
        <p>{{ allUsers.length }} users loaded</p>
        <div class="add-buttons">
          <button class="add-btn" @click="openAddModal('govt_admin')" title="Add Govt Admin">
            🏛️ +
          </button>
          <button class="add-btn" @click="openAddModal('school')" title="Add School">
            🏫 +
          </button>
          <button class="add-btn" @click="openAddModal('teacher')" title="Add Teacher">
            👩‍🏫 +
          </button>
          <button class="add-btn" @click="openAddModal('student')" title="Add Student">
            🎓 +
          </button>
        </div>
      </div>
    </div>

    <!-- Backdrop -->
    <div class="backdrop" v-show="isOpen" @click="isOpen = false" />

    <!-- Add Entity Modal -->
    <AddEntityModal
      :show="showAddModal"
      :entity-type="addEntityType"
      @close="showAddModal = false"
      @created="handleEntityCreated"
    />
  </div>
</template>

<style scoped>
.god-mode-panel {
  position: fixed;
  /* Bottom-LEFT so it never collides with the right-side controls
     (bug-feedback FAB, ModeTray / Settings trigger above the transport).
     The previous right-side pill was overlapping the Settings button. */
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  left: 24px;
  z-index: 9999;
  font-family: 'Source Sans 3', sans-serif;
}

/* Circular FAB — mirrors .feedback-fab in TesterFeedback.vue so the
   two floaters read as a consistent set. Distinguished by SSi gold. */
.god-fab {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: var(--gold, #d4a853);
  color: #1a1a2e;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(212, 168, 83, 0.4);
  transition: box-shadow 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
  opacity: 0.75;
  padding: 0;
}

.god-fab:hover {
  opacity: 1;
  box-shadow: 0 4px 18px rgba(212, 168, 83, 0.55);
}

.god-fab:active {
  transform: scale(0.96);
}

.god-fab:focus-visible {
  outline: 2px solid var(--gold, #d4a853);
  outline-offset: 3px;
  opacity: 1;
}

.god-fab-icon {
  font-size: 22px;
  line-height: 1;
}

/* Small indicator when an impersonation is active */
.god-fab-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent, #c23a3a);
  border: 2px solid var(--gold, #d4a853);
}

.panel-content {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 12px;
  width: 320px;
  max-height: 500px;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: rgba(212, 168, 83, 0.1);
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
  background: rgba(212, 168, 83, 0.2);
  color: #d4a853;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.current-user {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(212, 168, 83, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.no-user {
  padding: 12px 16px;
  color: #666;
  font-size: 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.user-avatar {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #d4a853, #c23a3a);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.user-name {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-role {
  font-size: 11px;
  color: #d4a853;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.user-context {
  font-size: 12px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.clear-btn {
  width: 24px;
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 4px;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-btn:hover {
  background: rgba(194, 58, 58, 0.3);
  color: #fff;
}

.quick-select {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.section-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
}

.quick-buttons {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.quick-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid transparent;
  border-radius: 6px;
  color: #b0b0b0;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.quick-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.quick-btn.active {
  background: rgba(212, 168, 83, 0.2);
  border-color: rgba(212, 168, 83, 0.3);
  color: #d4a853;
}

.btn-icon {
  font-size: 14px;
}

.search-section {
  padding: 12px 16px 8px;
}

.search-input {
  width: 100%;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  outline: none;
}

.search-input:focus {
  border-color: rgba(212, 168, 83, 0.5);
}

.search-input::placeholder {
  color: #666;
}

.role-filters {
  display: flex;
  gap: 4px;
  padding: 0 16px 12px;
}

.filter-btn {
  flex: 1;
  padding: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid transparent;
  border-radius: 4px;
  color: #888;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.filter-btn.active {
  background: rgba(212, 168, 83, 0.2);
  border-color: rgba(212, 168, 83, 0.3);
  color: #d4a853;
}

.user-list {
  flex: 1;
  overflow-y: auto;
  max-height: 200px;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.user-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.user-item.selected {
  background: rgba(212, 168, 83, 0.15);
}

.item-icon {
  font-size: 16px;
}

.item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.item-name {
  font-size: 13px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-context {
  font-size: 11px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-info {
  padding: 8px 16px;
  font-size: 11px;
  color: #666;
  text-align: center;
}

.loading {
  padding: 20px;
  text-align: center;
  color: #888;
  font-size: 13px;
}

.error {
  padding: 12px 16px;
  background: rgba(194, 58, 58, 0.1);
  color: #c23a3a;
  font-size: 12px;
}

.panel-footer {
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-footer p {
  margin: 0 0 8px 0;
  font-size: 11px;
  color: #666;
  text-align: center;
}

.add-buttons {
  display: flex;
  gap: 6px;
  justify-content: center;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-btn:hover {
  background: rgba(212, 168, 83, 0.2);
  border-color: rgba(212, 168, 83, 0.4);
  color: #d4a853;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
}

/* Animation */
.panel-content {
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
