<script setup lang="ts">
// Shared "everything Nick needs" card — used both right after a fresh
// create (staff carry a one-time password) and when re-opening an existing
// demo org from the list (passwords are never persisted, so only the
// mint-a-fresh-sign-in-link path works there — that's by design, a fresh
// magic link is a better credential to hand a prospect than a static
// password anyway).
import { ref } from 'vue'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'
import { useAdminClient } from '@/composables/useAdminClient'

export interface DemoStaffRow {
  role: 'govt_admin' | 'school_admin' | 'teacher'
  name: string
  email: string
  learnerId: string
  schoolName?: string
  password?: string
}

const props = defineProps<{
  orgName: string
  orgShape: string
  courseCode: string
  expiresAt: string
  counts: { schools: number; teachers: number; classes: number; learners: number }
  staff: DemoStaffRow[]
}>()

const { getAuthToken } = useAdminClient()

const mintedLinks = ref<Record<string, string>>({})
const mintingFor = ref<string | null>(null)
const mintError = ref<string | null>(null)

function roleLabel(role: string): string {
  if (role === 'govt_admin') return 'Group/Region Leader'
  if (role === 'school_admin') return 'School Leader'
  return 'Teacher'
}

function shapeLabel(shape: string): string {
  if (shape === 'single_school') return 'Single school'
  if (shape === 'group') return 'Group of schools'
  return 'Government region'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function mintLink(learnerId: string): Promise<void> {
  mintError.value = null
  mintingFor.value = learnerId
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/admin/create-signin-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ learner_id: learnerId }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to mint sign-in link')
    mintedLinks.value = { ...mintedLinks.value, [learnerId]: data.action_link }
  } catch (err) {
    mintError.value = err instanceof Error ? err.message : 'Failed to mint sign-in link'
  } finally {
    mintingFor.value = null
  }
}
</script>

<template>
  <div class="demo-org-card">
    <div class="org-summary">
      <div class="org-summary-row">
        <span class="org-name">{{ props.orgName }}</span>
        <span class="shape-pill">{{ shapeLabel(props.orgShape) }}</span>
      </div>
      <div class="org-meta">
        <span>{{ props.courseCode }}</span>
        <span class="meta-sep">·</span>
        <span>{{ props.counts.schools }} school{{ props.counts.schools === 1 ? '' : 's' }}</span>
        <span class="meta-sep">·</span>
        <span>{{ props.counts.teachers }} teachers</span>
        <span class="meta-sep">·</span>
        <span>{{ props.counts.classes }} classes</span>
        <span class="meta-sep">·</span>
        <span>{{ props.counts.learners }} learners</span>
        <span class="meta-sep">·</span>
        <span>Expires {{ formatDate(props.expiresAt) }}</span>
      </div>
    </div>

    <p v-if="staff.some(s => s.password)" class="password-notice">
      Passwords are shown once, now — they are never stored. Copy them before leaving this screen,
      or use "Mint sign-in link" any time later instead.
    </p>
    <p v-if="mintError" class="mint-error">{{ mintError }}</p>

    <div class="staff-list">
      <div v-for="s in staff" :key="s.learnerId" class="staff-row">
        <div class="staff-info">
          <span class="staff-role" :class="`role-${s.role}`">{{ roleLabel(s.role) }}</span>
          <span class="staff-name">{{ s.name }}</span>
          <span v-if="s.schoolName" class="staff-school">{{ s.schoolName }}</span>
        </div>
        <div class="staff-creds">
          <code class="staff-email">{{ s.email }}</code>
          <code v-if="s.password" class="staff-password">{{ s.password }}</code>
        </div>
        <div class="staff-actions">
          <button
            type="button"
            class="btn-ghost btn-small"
            :disabled="mintingFor === s.learnerId"
            @click="mintLink(s.learnerId)"
          >
            {{ mintingFor === s.learnerId ? 'Minting…' : 'Mint sign-in link' }}
          </button>
        </div>
        <InviteLinkField
          v-if="mintedLinks[s.learnerId]"
          :url="mintedLinks[s.learnerId]"
          :label="`Sign-in link for ${s.email}`"
          class="staff-link-field"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.demo-org-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
}

.org-summary-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.org-name {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  color: var(--schools-fg);
}

.shape-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: rgba(var(--tone-blue), 0.12);
  border: 1px solid rgba(var(--tone-blue), 0.32);
  color: rgb(var(--tone-blue-ink));
}

.org-meta {
  margin-top: 6px;
  font-size: var(--text-sm);
  color: var(--schools-fg-3);
}

.meta-sep { margin: 0 6px; }

.password-notice {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-gold), 0.10);
  border: 1px solid rgba(var(--tone-gold), 0.30);
  border-radius: var(--radius-md);
  color: var(--schools-fg-2);
  font-size: var(--text-sm);
}

.mint-error {
  margin: 0;
  color: rgb(var(--tone-red));
  font-size: var(--text-sm);
}

.staff-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.staff-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  background: var(--schools-bg);
  border: 1px solid var(--schools-border);
  border-radius: var(--radius-lg);
}

.staff-link-field {
  grid-column: 1 / -1;
}

.staff-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.staff-role {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
}

.staff-role.role-govt_admin { color: rgb(var(--tone-gold-ink)); }
.staff-role.role-school_admin { color: rgb(var(--tone-green-ink)); }

.staff-name {
  font-weight: var(--font-medium);
  color: var(--schools-fg);
}

.staff-school {
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}

.staff-creds {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}

.staff-email, .staff-password {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--schools-fg-2);
}

.staff-password {
  color: rgb(var(--tone-gold-ink));
  font-weight: var(--font-semibold);
}

@media (max-width: 640px) {
  .staff-row {
    grid-template-columns: 1fr;
  }
  .staff-creds {
    align-items: flex-start;
  }
}
</style>
