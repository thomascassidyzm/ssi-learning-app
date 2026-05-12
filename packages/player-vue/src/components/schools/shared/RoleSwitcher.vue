<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

export type RoleId = 'teacher' | 'admin' | 'govt' | string

export type RoleUser = {
  initials: string
  name: string
  school?: string
}

export type RoleOption = {
  id: RoleId
  label: string
  description?: string
  user: RoleUser
  color?: string
}

const props = defineProps<{
  role: RoleId
  user: RoleUser
  roleLabel: string
  /**
   * If provided with more than one entry, the dropdown shows a switcher.
   * If omitted or single-entry, the dropdown only exposes sign-out.
   */
  availableRoles?: RoleOption[]
}>()

const emit = defineEmits<{
  (e: 'change-role', id: RoleId): void
  (e: 'sign-out'): void
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

function roleColor(id: RoleId): string {
  if (id === 'teacher') return 'var(--schools-role-teacher)'
  if (id === 'admin')   return 'var(--schools-role-admin)'
  if (id === 'govt')    return 'var(--schools-role-govt)'
  return 'var(--schools-fg-2)'
}

function pickRole(id: RoleId) {
  emit('change-role', id)
  open.value = false
}
</script>

<template>
  <div ref="root" class="role-switcher">
    <button type="button" class="role-trigger" @click="open = !open">
      <span class="avatar" :style="{ background: roleColor(props.role) }">
        {{ props.user.initials }}
      </span>
      <span class="identity">
        <span class="identity-name">{{ props.user.name }}</span>
        <span class="identity-role">{{ props.roleLabel }}</span>
      </span>
      <span class="caret">▾</span>
    </button>

    <div v-if="open" class="menu">
      <div v-if="props.availableRoles && props.availableRoles.length > 1" class="menu-header">
        Acting as
      </div>
      <button
        v-for="opt in (props.availableRoles && props.availableRoles.length > 1 ? props.availableRoles : [])"
        :key="opt.id"
        type="button"
        :class="['menu-row', { active: opt.id === props.role }]"
        @click="pickRole(opt.id)"
      >
        <span class="avatar small" :style="{ background: opt.color || roleColor(opt.id) }">
          {{ opt.user.initials }}
        </span>
        <span class="menu-text">
          <span class="menu-name">{{ opt.user.name }}</span>
          <span v-if="opt.description" class="menu-desc">{{ opt.description }}</span>
        </span>
        <span v-if="opt.id === props.role" class="menu-active">●</span>
      </button>
      <button type="button" class="menu-signout" @click="emit('sign-out'); open = false">
        Sign out
      </button>
    </div>
  </div>
</template>

<style scoped>
.role-switcher { position: relative; }

.role-trigger {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px 5px 5px;
  border: 1px solid var(--schools-border);
  background: #fff;
  border-radius: 30px;
  cursor: pointer;
  font-family: var(--font-body);
}
.role-trigger:hover { border-color: var(--schools-border-strong); }

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex: none;
}
.avatar.small { width: 28px; height: 28px; font-size: 11px; }

.identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
  gap: 1px;
  min-width: 0;
  max-width: 140px;
}
.identity-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--schools-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.identity-role {
  font-size: 10.5px;
  color: var(--schools-fg-2);
  white-space: nowrap;
}

.caret { font-size: 10px; color: var(--schools-fg-3); margin-right: 4px; }

.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 260px;
  z-index: 50;
  background: #fff;
  border: 1px solid var(--schools-border);
  border-radius: 10px;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.menu-header {
  padding: 10px 12px 8px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
  border-bottom: 1px solid var(--schools-border);
}

.menu-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: #fff;
  border: none;
  cursor: pointer;
  text-align: left;
  border-bottom: 1px solid var(--schools-border);
  font-family: var(--font-body);
}
.menu-row.active { background: #f6f5f1; }
.menu-row:hover { background: #fafaf6; }

.menu-text { flex: 1; min-width: 0; }
.menu-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--schools-fg);
}
.menu-desc {
  display: block;
  font-size: 11px;
  color: var(--schools-fg-2);
}
.menu-active { color: var(--schools-red); font-size: 14px; }

.menu-signout {
  display: block;
  width: 100%;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--schools-fg-2);
  text-decoration: none;
  text-align: center;
  background: #fff;
  border: none;
  cursor: pointer;
  font-family: var(--font-body);
}
.menu-signout:hover { color: var(--schools-fg); background: #fafaf6; }
</style>
