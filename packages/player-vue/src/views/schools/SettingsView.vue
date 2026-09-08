<script setup lang="ts">
import { ref, computed, onMounted, watch, inject, defineAsyncComponent } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

type SectionId = 'profile' | 'locale' | 'data' | 'billing'

// A computed, not a plain array, for the same reason as dataToggles below:
// evaluated once at setup it would read t() before the locale chunk has
// landed and freeze the section nav in English for the session.
const SECTIONS = computed<{ id: SectionId; label: string }[]>(() => [
  { id: 'profile', label: t('schools.schoolSettings.sectionProfile', 'School profile') },
  { id: 'locale', label: t('schools.schoolSettings.sectionLocalisation', 'Localisation') },
  { id: 'data', label: t('schools.schoolSettings.sectionDataPrivacy', 'Data & privacy') },
  { id: 'billing', label: t('schools.schoolSettings.sectionBilling', 'Billing') },
])

const isAdminView = inject<boolean>('isAdminView', false)
const supabase = inject<import('vue').Ref<any>>('supabase', ref(null))
const { currentUser, isSchoolAdmin } = useSchoolContext()
const { activeSchool, currentSchool, fetchSchools } = useSchoolData()

// WHO YOUR LINKS LET IN (job #371). The school's claimed email domains and
// the named addresses the admin has let in by hand. An arrival at the
// school's invite links from one of these is in with one tap; anyone else
// gets in too but stays marked "unverified" on the Teachers page until they
// confirm the address. Read and written through /api/school/identity-claims
// only — the table is service-role-only.
interface IdentityClaim { id: string; kind: 'domain' | 'address'; value: string; source: string; created_at: string }
const identityClaims = ref<IdentityClaim[]>([])
const identityError = ref<string | null>(null)
const identityBusy = ref(false)
const newDomain = ref('')
const newAddress = ref('')
const claimedDomains = computed(() => identityClaims.value.filter(c => c.kind === 'domain'))
const allowedAddresses = computed(() => identityClaims.value.filter(c => c.kind === 'address'))

async function identityHeaders(): Promise<Record<string, string> | null> {
  if (!supabase?.value) return null
  const { data: { session } } = await supabase.value.auth.getSession()
  const token = session?.access_token
  if (!token) return null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

async function loadIdentityClaims() {
  const headers = await identityHeaders()
  if (!headers) return
  const school = activeSchool.value || currentSchool.value
  const q = school?.id ? `?school_id=${encodeURIComponent(school.id)}` : ''
  try {
    const res = await fetch(`/api/school/identity-claims${q}`, { headers })
    if (!res.ok) return
    const data = await res.json()
    identityClaims.value = Array.isArray(data.claims) ? data.claims : []
  } catch (err) {
    console.error('Failed to load identity claims:', err)
  }
}

async function addIdentityClaim(kind: 'domain' | 'address') {
  const value = (kind === 'domain' ? newDomain.value : newAddress.value).trim()
  if (!value || identityBusy.value) return
  const headers = await identityHeaders()
  if (!headers) return
  identityBusy.value = true
  identityError.value = null
  try {
    const school = activeSchool.value || currentSchool.value
    const res = await fetch('/api/school/identity-claims', {
      method: 'POST', headers, body: JSON.stringify({ kind, value, school_id: school?.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      identityError.value = data.error || t('schools.identity.failed', 'That could not be added.')
      return
    }
    if (kind === 'domain') newDomain.value = ''
    else newAddress.value = ''
    await loadIdentityClaims()
  } catch (err) {
    identityError.value = t('schools.identity.failed', 'That could not be added.')
    console.error('Failed to add identity claim:', err)
  } finally {
    identityBusy.value = false
  }
}

async function removeIdentityClaim(id: string) {
  const headers = await identityHeaders()
  if (!headers || identityBusy.value) return
  identityBusy.value = true
  identityError.value = null
  try {
    const school = activeSchool.value || currentSchool.value
    const res = await fetch('/api/school/identity-claims', {
      method: 'DELETE', headers, body: JSON.stringify({ id, school_id: school?.id }),
    })
    if (res.ok) await loadIdentityClaims()
  } catch (err) {
    console.error('Failed to remove identity claim:', err)
  } finally {
    identityBusy.value = false
  }
}

// School profile edits + Billing are admin-only (renaming the school and
// changing paid seats are school_admin actions server-side — see
// api/school/update-profile.ts / update-seats.ts). A plain teacher gets the
// profile section read-only and the Billing tab hidden entirely, matching
// how other admin-only controls hide (not disable) for teachers elsewhere
// (e.g. TeachersView's invite/remove buttons).
const canEditSchool = computed(() => isSchoolAdmin.value && !isAdminView)
// No billing panel in this build (store shell) => no Billing tab either.
const visibleSections = computed(() =>
  SECTIONS.value.filter((s) => s.id !== 'billing' || (isSchoolAdmin.value && seatPurchaseAvailable)))

const activeSection = ref<SectionId>('profile')

// Profile state
const schoolNameEdit = ref('')
const schoolEmailEdit = ref('')
// The admin's real signup email — the sensible default for the school's contact
// email (replaces the old invented `contact@<slug>.edu`). Resolved from the
// authenticated session.
const adminEmail = ref('')
const city = ref('')
const region = ref('')
const about = ref('')
const profileSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle')

// Localisation state
const language = ref('en')
const timezone = ref('Europe/London')
const weekStart = ref('Monday')
const showFlags = ref(true)
const localizationSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle')

// Data & privacy toggles (visual placeholders — no DB column yet).
//
// State and labels are deliberately separate. t() inside a ref() initialiser
// runs ONCE, during setup — and on boot the non-English locale chunk is still
// being fetched at that moment, so a ref would freeze these four rows in
// English for the whole session. The labels are a computed, which re-reads t()
// when the chunk lands; only the on/off value is state.
const dataToggleValues = ref<Record<string, boolean>>({
  analytics: true,
  messaging: false,
  realnames: true,
  retention: false,
})
const dataToggles = computed(() => [
  {
    id: 'analytics',
    title: t('schools.schoolSettings.toggleAnalyticsTitle', 'Share anonymised analytics with the SSi team'),
    desc: t('schools.schoolSettings.toggleAnalyticsDesc', 'Helps us improve recommendations across schools.'),
    value: dataToggleValues.value.analytics,
  },
  {
    id: 'messaging',
    title: t('schools.schoolSettings.toggleMessagingTitle', 'Allow students to message each other'),
    desc: t('schools.schoolSettings.toggleMessagingDesc', 'Disabled by default in school accounts.'),
    value: dataToggleValues.value.messaging,
  },
  {
    id: 'realnames',
    title: t('schools.schoolSettings.toggleRealnamesTitle', 'Show student real names to other students'),
    desc: t('schools.schoolSettings.toggleRealnamesDesc', 'When off, only first name + initial is shown.'),
    value: dataToggleValues.value.realnames,
  },
  {
    id: 'retention',
    title: t('schools.schoolSettings.toggleRetentionTitle', 'Retain inactive accounts after 12 months'),
    desc: t('schools.schoolSettings.toggleRetentionDesc', 'Otherwise we delete them automatically.'),
    value: dataToggleValues.value.retention,
  },
])
const isExporting = ref(false)

// Billing summary only. The actual subscribe / seat-change flow lives on the
// canonical Upgrade page (/schools/upgrade) — this section just shows the plan
// line and links there, so checkout logic isn't duplicated across surfaces.
const PRICE_PER_SEAT_GBP = 15
const seatCount = ref(1)

// Live subscription state, read from the server for an accurate plan summary.
const platformStatus = ref<string | null>(null)
const paidSeats = ref<number | null>(null)
const isSubscribed = computed(() => platformStatus.value === 'active')

async function authHeaders(): Promise<Record<string, string> | null> {
  if (!supabase.value) return null
  const { data: { session } } = await supabase.value.auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

async function loadSubscription() {
  const headers = await authHeaders()
  if (!headers) return
  try {
    const res = await fetch('/api/school/subscription', { headers })
    if (!res.ok) return
    const data = await res.json()
    platformStatus.value = data?.school?.platform_status ?? null
    const seats = data?.school?.teacher_seats
    if (typeof seats === 'number' && seats > 0) {
      paidSeats.value = seats
      // Seed the stepper from what's actually paid for, once.
      if (isSubscribed.value) seatCount.value = seats
    }
    // NOT subscribed → the plan line is a quote, not a bill, so quote against
    // the school's ACTUAL staff count (server-side, founding admin included)
    // rather than the hard-coded 1. Matches what /schools/upgrade now opens at,
    // so the two surfaces can't disagree about the same school.
    const count = data?.school?.teacher_count
    if (!isSubscribed.value && typeof count === 'number' && count > 1) {
      seatCount.value = count
    }
  } catch {
    // Non-fatal — billing UI just stays in its default (Subscribe) state.
  }
}

import {
  INSTITUTIONAL_PURCHASE_IN_BUILD,
  institutionalPurchaseAvailable,
  paddleBillingAvailable,
} from '@/platform/paymentRoute'
// Seat purchase + the Paddle portal are the WEB rail (platform/paymentRoute).
// The constant keeps the panel's markup out of a store BUILD; what an admin
// SEES asks the seam, so a web build inside the WebView hides it too.
const SchoolBillingPanel = INSTITUTIONAL_PURCHASE_IN_BUILD
  ? defineAsyncComponent(() => import('./SchoolBillingPanel.vue'))
  : null
const seatPurchaseAvailable = computed(() => institutionalPurchaseAvailable())

// Paddle billing portal — invoices, card updates, cancellation. Only
// meaningful once subscribed (the webhook stamps provider_customer_id).
const isOpeningPortal = ref(false)
const portalError = ref('')
async function openBillingPortal() {
  if (isOpeningPortal.value) return
  // Paddle's hosted portal is the web rail's own machinery.
  if (!paddleBillingAvailable()) return
  isOpeningPortal.value = true
  portalError.value = ''
  try {
    const headers = await authHeaders()
    if (!headers) {
      portalError.value = t('schools.schoolSettings.signInAgainBilling', 'Sign in again to open billing')
      return
    }
    const res = await fetch('/api/school/portal', { headers })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.portalUrl) {
      window.location.href = data.portalUrl
      return
    }
    portalError.value = data?.error || t('schools.schoolSettings.couldNotOpenPortal', 'Could not open the billing portal — try again')
  } catch {
    portalError.value = t('schools.schoolSettings.couldNotOpenPortal', 'Could not open the billing portal — try again')
  } finally {
    isOpeningPortal.value = false
  }
}

// Delete school — self-serve for the school's own admin ("every level can
// delete the things it created", founder ruling). api/admin/update-school.ts
// enforces ownership server-side (schoolIdForAdmin), same shape as the
// ssi_admin delete path it already had.
const showDeleteSchoolModal = ref(false)
const deleteSchoolImpact = ref<{
  schoolName: string
  classCount: number
  sessionCount: number
  learnerCount: number
  teacherCount: number
  hasRealActivity: boolean
} | null>(null)
const isDeletingSchool = ref(false)
const deleteSchoolError = ref('')

async function openDeleteSchoolModal() {
  deleteSchoolError.value = ''
  deleteSchoolImpact.value = null
  const headers = await authHeaders()
  const schoolId = activeSchool.value?.id
  if (!headers || !schoolId) return
  try {
    const res = await fetch(`/api/admin/update-school?school_id=${encodeURIComponent(schoolId)}`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.ok) deleteSchoolImpact.value = data.impact
  } catch { /* modal still opens; impact list just stays empty */ }
  showDeleteSchoolModal.value = true
}

function closeDeleteSchoolModal() {
  showDeleteSchoolModal.value = false
  deleteSchoolError.value = ''
}

async function confirmDeleteSchool(typedName: string) {
  const headers = await authHeaders()
  const schoolId = activeSchool.value?.id
  if (!headers || !schoolId) {
    deleteSchoolError.value = t('schools.schoolSettings.signInAgainDelete', 'Sign in again to delete your school')
    return
  }
  isDeletingSchool.value = true
  deleteSchoolError.value = ''
  try {
    const params = typedName ? `?confirm_name=${encodeURIComponent(typedName)}` : ''
    const res = await fetch(`/api/admin/update-school?school_id=${encodeURIComponent(schoolId)}${params}`, {
      method: 'DELETE',
      headers,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (data.impact) deleteSchoolImpact.value = data.impact
      deleteSchoolError.value = data.error || t('schools.schoolSettings.failedToDeleteSchool', 'Failed to delete school')
      return
    }
    // The admin's own school is gone — sign out to a clean slate, same
    // escape-hatch pattern as SchoolsContainer's "no school access" wall.
    await supabase.value?.auth?.signOut()
    window.location.href = '/schools'
  } catch {
    deleteSchoolError.value = t('schools.schoolSettings.failedToDeleteSchool', 'Failed to delete school')
  } finally {
    isDeletingSchool.value = false
  }
}

const deleteSchoolImpactLines = computed(() => {
  const impact = deleteSchoolImpact.value
  if (!impact) return []
  const lines: string[] = []
  if (impact.classCount) lines.push(t('schools.schoolSettings.impactClasses', '{n} class{es}').replace('{n}', String(impact.classCount)).replace('{es}', impact.classCount === 1 ? '' : 'es'))
  if (impact.learnerCount) lines.push(t('schools.schoolSettings.impactStudents', '{n} student{s}').replace('{n}', String(impact.learnerCount)).replace('{s}', impact.learnerCount === 1 ? '' : 's'))
  if (impact.teacherCount) lines.push(t('schools.schoolSettings.impactTeachers', '{n} teacher{s}').replace('{n}', String(impact.teacherCount)).replace('{s}', impact.teacherCount === 1 ? '' : 's'))
  if (impact.sessionCount) lines.push(t('schools.schoolSettings.impactSessions', '{n} recorded session{s}').replace('{n}', String(impact.sessionCount)).replace('{s}', impact.sessionCount === 1 ? '' : 's'))
  return lines
})

function syncFromSchoolData() {
  const school = activeSchool.value || currentSchool.value
  schoolNameEdit.value = school?.school_name || currentUser.value?.school_name || ''
  region.value = school?.region_code?.toUpperCase() || currentUser.value?.region_code?.toUpperCase() || ''
  // Contact email defaults to the school's saved value if present, else the
  // admin's real signup email — never a fabricated `contact@<slug>.edu`.
  schoolEmailEdit.value = (school as any)?.contact_email || adminEmail.value || ''
}

watch(currentUser, async (u) => {
  if (u) {
    await fetchSchools()
    // Resolve the admin's signup email before seeding the profile fields so the
    // contact-email default is the real address, not an invented one.
    try {
      const { data } = (await supabase.value?.auth.getUser()) ?? { data: null }
      adminEmail.value = data?.user?.email || ''
    } catch { /* non-fatal — field just defaults to any saved value or blank */ }
    syncFromSchoolData()
  }
}, { immediate: true })

watch([activeSchool, currentSchool], syncFromSchoolData)

onMounted(() => {
  language.value = localStorage.getItem('ssi-language') || 'en'
  timezone.value = localStorage.getItem('ssi-timezone') || 'Europe/London'
  loadSubscription()
  loadIdentityClaims()
})
watch([activeSchool, currentSchool], () => { loadIdentityClaims() })

async function saveSchoolProfile() {
  const school = activeSchool.value || currentSchool.value
  if (!school) return
  profileSaveStatus.value = 'saving'
  try {
    // The `schools` table's authenticated UPDATE grant is revoked (see
    // CLAUDE.md RLS section) — routed through the same caller-scoped server
    // endpoint SetupView.vue's saveSchool() uses (finding #2c, 2026-07-13
    // audit) rather than a direct client write.
    if (!supabase?.value) throw new Error('Not signed in')
    const { data: { session } } = await supabase.value.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Not signed in')
    const res = await fetch('/api/school/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ school_name: schoolNameEdit.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${res.status}`)
    }
    profileSaveStatus.value = 'saved'
    setTimeout(() => { profileSaveStatus.value = 'idle' }, 2000)
    await fetchSchools()
  } catch (err) {
    console.error('Failed to save school profile:', err)
    profileSaveStatus.value = 'idle'
  }
}

function saveLocalization() {
  localizationSaveStatus.value = 'saving'
  localStorage.setItem('ssi-timezone', timezone.value)
  localStorage.setItem('ssi-language', language.value)
  setTimeout(() => {
    localizationSaveStatus.value = 'saved'
    setTimeout(() => { localizationSaveStatus.value = 'idle' }, 2000)
  }, 250)
}

async function handleExportData() {
  const school = activeSchool.value || currentSchool.value
  if (!school) return
  isExporting.value = true
  try {
    const { getSchoolsClient } = await import('@/composables/schools/client')
    const client = getSchoolsClient()
    const { data: progress } = await client
      .from('class_student_progress')
      .select('*')
      .eq('school_id', school.id)

    const rows = (progress || []).map((p: any) =>
      [p.student_name, p.class_name, p.seeds_completed, p.total_practice_seconds, p.last_active_at].join(','),
    )
    const csv = ['Student,Class,Seeds Completed,Practice Seconds,Last Active', ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${school.school_name.replace(/\s+/g, '-').toLowerCase()}-data-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Export failed:', err)
  } finally {
    isExporting.value = false
  }
}

const planLine = computed(() => {
  const name = (activeSchool.value || currentSchool.value)?.school_name || currentUser.value?.school_name || t('schools.schoolSettings.yourSchool', 'Your school')
  // When subscribed, anchor on what's actually PAID (DB), not the local stepper.
  const n = isSubscribed.value && paidSeats.value != null ? paidSeats.value : seatCount.value
  const seatWord = t('schools.schoolSettings.teacherSeatWord', 'teacher {seatOrSeats}').replace('{seatOrSeats}', n === 1 ? t('schools.schoolSettings.seat', 'seat') : t('schools.schoolSettings.seats', 'seats'))
  return isSubscribed.value
    ? t('schools.schoolSettings.planLineActive', '{name} — {n} {seatWord} (active)').replace('{name}', name).replace('{n}', String(n)).replace('{seatWord}', seatWord)
    : t('schools.schoolSettings.planLine', '{name} — {n} {seatWord}').replace('{name}', name).replace('{n}', String(n)).replace('{seatWord}', seatWord)
})

function toggleDataItem(id: string) {
  if (id in dataToggleValues.value) dataToggleValues.value[id] = !dataToggleValues.value[id]
}
</script>

<template>
  <main class="settings-screen">
    <h1 class="arsenal page-title">{{ t('schools.schoolSettings.title', 'Settings') }}</h1>

    <div class="settings-layout">
      <aside class="schools-card section-nav">
        <button
          v-for="s in visibleSections"
          :key="s.id"
          type="button"
          class="section-link"
          :class="{ active: activeSection === s.id }"
          @click="activeSection = s.id"
        >
          {{ s.label }}
        </button>
      </aside>

      <div class="settings-content">
        <section v-if="activeSection === 'profile'" class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">{{ t('schools.schoolSettings.sectionProfile', 'School profile') }}</h2>
          <label class="field">
            <span class="field-label">{{ t('schools.schoolSettings.schoolName', 'School name') }}</span>
            <input v-model="schoolNameEdit" class="field-input" type="text" :readonly="!canEditSchool" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('schools.schoolSettings.type', 'Type') }}</span>
            <input :value="t('schools.schoolSettings.typeValue', 'Bilingual immersion · primary + lower secondary')" class="field-input" type="text" readonly />
            <span class="field-hint">{{ t('schools.schoolSettings.typeHint', 'Type is set by your group administrator.') }}</span>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">{{ t('schools.schoolSettings.city', 'City') }}</span>
              <input v-model="city" class="field-input" type="text" placeholder="—" :readonly="!canEditSchool" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('schools.schoolSettings.region', 'Region') }}</span>
              <input v-model="region" class="field-input" type="text" placeholder="—" :readonly="!canEditSchool" />
            </label>
          </div>
          <label class="field">
            <span class="field-label">{{ t('schools.schoolSettings.contactEmail', 'Contact email') }}</span>
            <input v-model="schoolEmailEdit" class="field-input" type="email" :readonly="!canEditSchool" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('schools.schoolSettings.about', 'About') }}</span>
            <textarea v-model="about" rows="3" class="field-input field-textarea" :placeholder="t('schools.schoolSettings.aboutPlaceholder', 'A short description of your school.')" :readonly="!canEditSchool" />
          </label>
          <p v-if="!canEditSchool" class="field-hint">{{ t('schools.schoolSettings.onlyAdminCanEditProfile', 'Only a school admin can edit the school profile.') }}</p>
          <div v-if="canEditSchool" class="panel-actions">
            <!-- HANDBOOK Change your school's name and details
                 section: your-school
                 roles: school_admin
                 place: settings
                 keywords: rename, name, profile, school, details, contact, email, city, region, about, edit
                 What it's for. Correcting or updating what the app knows about
                 your school — its name, its town, its contact email and a short
                 description. The name is the one that shows on every page your
                 staff and students see.
                 Where it is. Settings, then School profile.
                 How you do it.
                 1. Open Settings and stay on School profile.
                 2. Edit any of the fields — school name, city, region, contact
                    email, about.
                 3. Tap **Save changes**. The button reads Saved when it has gone
                    through.
                 4. The new name appears across the dashboard straight away.
                 Worth knowing. Only a school admin can edit this. A teacher
                 opening the same page sees the details but cannot change them.
                 Your school's type is set by your group administrator, not here.
                 checked: ac34d640.51c105f3
            -->
            <button type="button" class="btn-play" data-walk="settings-save-profile" :disabled="profileSaveStatus === 'saving'" @click="saveSchoolProfile">
              {{ profileSaveStatus === 'saving' ? t('schools.schoolSettings.saving', 'Saving…') : profileSaveStatus === 'saved' ? t('schools.schoolSettings.saved', 'Saved') : t('schools.schoolSettings.saveChanges', 'Save changes') }}
            </button>
            <button type="button" class="btn-ghost">{{ t('schools.schoolSettings.cancel', 'Cancel') }}</button>
          </div>
        </section>

        <section v-if="canEditSchool" class="settings-panel identity-panel">
          <h2 class="panel-title">{{ t('schools.identity.title', 'Who your links let in') }}</h2>
          <p class="field-hint">
            {{ t('schools.identity.intro', 'Anyone who opens your teacher or admin link from one of these email domains or addresses is in with one tap. Others still get in, but show as "Unverified address" on the Teachers page until they confirm their email.') }}
          </p>

          <div class="identity-group">
            <span class="field-label">{{ t('schools.identity.domains', 'Your school\'s email domains') }}</span>
            <ul class="identity-list">
              <li v-for="c in claimedDomains" :key="c.id" class="identity-row">
                <span class="identity-value">@{{ c.value }}</span>
                <!-- HANDBOOK Take a domain or address off your school's list
                     section: getting-people-in
                     roles: school_admin
                     place: settings
                     keywords: domain, address, remove, allow, links, identity
                     What it's for. Stopping a domain or a named address from being waved straight in by your invite links.
                     Where it is. Settings, the **Who your links let in** card, the **Remove** button beside the entry.
                     How you do it.
                     1. Open Settings and find **Who your links let in**.
                     2. Tap **Remove** beside the domain or address.
                     Worth knowing. Nobody already in your school loses anything. It only changes how the next arrival from that domain or address is treated.
                     checked: 9d2b1f89.f017f119
                -->
                <button type="button" class="btn-text identity-remove" data-walk="settings-identity-remove" :disabled="identityBusy" @click="removeIdentityClaim(c.id)">{{ t('schools.identity.remove', 'Remove') }}</button>
              </li>
              <li v-if="!claimedDomains.length" class="identity-empty">{{ t('schools.identity.noDomains', 'No domain claimed yet. Add the part of your school email after the @.') }}</li>
            </ul>
            <div class="identity-add">
              <input v-model="newDomain" type="text" class="field-input" :placeholder="t('schools.identity.domainPlaceholder', 'example.sch.uk')" autocapitalize="none" autocorrect="off" spellcheck="false" @keyup.enter="addIdentityClaim('domain')" />
              <!-- HANDBOOK Claim another email domain for your school
                   section: getting-people-in
                   roles: school_admin
                   place: settings
                   keywords: domain, email, claim, trust, links, identity, sch.uk
                   What it's for. Telling the app which email domains belong to your school, so staff arriving on your invite links from those addresses are in with one tap. Your own domain was claimed when you signed up; add the others if your school uses more than one.
                   Where it is. Settings, the **Who your links let in** card, the **Add domain** field.
                   How you do it.
                   1. Open Settings and find **Who your links let in**.
                   2. Type the part of the address after the @, such as example.sch.uk.
                   3. Tap **Add domain**.
                   Worth knowing. Public providers such as gmail.com or outlook.com cannot be claimed, because they do not identify a school. For a colleague on one of those, add their address by itself instead. Schools in the same trust share each other's domains automatically.
                   checked: 67cb1738.af5b252f
              -->
              <button type="button" class="btn-play" data-walk="settings-identity-add-domain" :disabled="identityBusy || !newDomain.trim()" @click="addIdentityClaim('domain')">{{ t('schools.identity.addDomain', 'Add domain') }}</button>
            </div>
          </div>

          <div class="identity-group">
            <span class="field-label">{{ t('schools.identity.addresses', 'Individual addresses you have let in') }}</span>
            <ul class="identity-list">
              <li v-for="c in allowedAddresses" :key="c.id" class="identity-row">
                <span class="identity-value">{{ c.value }}</span>
                <button type="button" class="btn-text identity-remove" :disabled="identityBusy" @click="removeIdentityClaim(c.id)">{{ t('schools.identity.remove', 'Remove') }}</button>
              </li>
              <li v-if="!allowedAddresses.length" class="identity-empty">{{ t('schools.identity.noAddresses', 'None yet. Use this for supply staff, or a colleague who only has a personal address.') }}</li>
            </ul>
            <div class="identity-add">
              <input v-model="newAddress" type="email" class="field-input" :placeholder="t('schools.identity.addressPlaceholder', 'name@example.com')" autocapitalize="none" autocorrect="off" spellcheck="false" @keyup.enter="addIdentityClaim('address')" />
              <!-- HANDBOOK Let a named address in through your links
                   section: getting-people-in
                   roles: school_admin
                   place: settings
                   keywords: supply, personal, address, allow, invite, links, identity, gmail
                   What it's for. Letting one named person in with one tap when their email is not at your school's domain: a supply teacher here for a fortnight, or a colleague who only uses a personal address.
                   Where it is. Settings, the **Who your links let in** card, the **Add address** field.
                   How you do it.
                   1. Open Settings and find **Who your links let in**.
                   2. Type their email address exactly as they will use it.
                   3. Tap **Add address**, then send them your usual teacher link.
                   Worth knowing. Without this they can still open the link and get in, but they show as **Unverified address** on the Teachers page until they confirm their email. Adding them here first skips that.
                   checked: b27fdce0.c4b93315
              -->
              <button type="button" class="btn-play" data-walk="settings-identity-add-address" :disabled="identityBusy || !newAddress.trim()" @click="addIdentityClaim('address')">{{ t('schools.identity.addAddress', 'Add address') }}</button>
            </div>
          </div>
          <p v-if="identityError" class="field-hint identity-error" role="alert">{{ identityError }}</p>
        </section>

        <section v-else-if="activeSection === 'locale'" class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">{{ t('schools.schoolSettings.sectionLocalisation', 'Localisation') }}</h2>
          <label class="field">
            <span class="field-label">{{ t('schools.schoolSettings.defaultInterfaceLanguage', 'Default interface language') }}</span>
            <select v-model="language" class="field-input">
              <option value="en">{{ t('schools.schoolSettings.langEnglish', 'English') }}</option>
              <option value="cy">{{ t('schools.schoolSettings.langWelsh', 'Cymraeg (Welsh)') }}</option>
              <option value="es">{{ t('schools.schoolSettings.langSpanish', 'Español (Spanish)') }}</option>
              <option value="br">{{ t('schools.schoolSettings.langBreton', 'Brezhoneg (Breton)') }}</option>
            </select>
            <span class="field-hint">{{ t('schools.schoolSettings.languageOverrideHint', 'Teachers and students can override individually.') }}</span>
          </label>
          <label class="field">
            <span class="field-label">{{ t('schools.schoolSettings.timeZone', 'Time zone') }}</span>
            <select v-model="timezone" class="field-input">
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Paris">Europe/Paris</option>
              <option value="Europe/Dublin">Europe/Dublin</option>
              <option value="America/New_York">America/New York</option>
              <option value="America/Los_Angeles">America/Los Angeles</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ t('schools.schoolSettings.weekStartsOn', 'Week starts on') }}</span>
            <select v-model="weekStart" class="field-input">
              <option value="Monday">{{ t('schools.schoolSettings.monday', 'Monday') }}</option>
              <option value="Sunday">{{ t('schools.schoolSettings.sunday', 'Sunday') }}</option>
            </select>
          </label>
          <div class="toggle-row">
            <div>
              <div class="toggle-title">{{ t('schools.schoolSettings.showFlagsTitle', 'Show flags on courses') }}</div>
              <div class="toggle-desc">{{ t('schools.schoolSettings.showFlagsDesc', 'Display country flags next to course names.') }}</div>
            </div>
            <button
              type="button"
              class="toggle"
              :class="{ on: showFlags }"
              :aria-pressed="showFlags"
              @click="showFlags = !showFlags"
            >
              <span class="toggle-thumb" />
            </button>
          </div>
          <div v-if="!isAdminView" class="panel-actions">
            <!-- HANDBOOK Set your language and time zone
                 section: your-school
                 roles: school_admin, teacher
                 place: settings
                 keywords: language, welsh, cymraeg, spanish, time zone, timezone, localisation, interface, week
                 What it's for. Choosing the language the dashboard itself speaks
                 to you in, and the time zone your dates and times are read
                 against.
                 Where it is. Settings, then Localisation.
                 How you do it.
                 1. Open Settings and choose Localisation.
                 2. Pick a **Default interface language**.
                 3. Pick a **Time zone** so activity times read correctly for where
                    you are.
                 4. Tap **Save changes**.
                 Worth knowing. This is remembered on the device you set it on.
                 Teachers and students each choose their own, so setting it here
                 does not change what anybody else sees.
                 checked: 0626c6d1.ca2221e1
            -->
            <button type="button" class="btn-play" data-walk="settings-localisation-save" :disabled="localizationSaveStatus === 'saving'" @click="saveLocalization">
              {{ localizationSaveStatus === 'saving' ? t('schools.schoolSettings.saving', 'Saving…') : localizationSaveStatus === 'saved' ? t('schools.schoolSettings.saved', 'Saved') : t('schools.schoolSettings.saveChanges', 'Save changes') }}
            </button>
          </div>
        </section>

        <section v-else-if="activeSection === 'data'" class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">{{ t('schools.schoolSettings.sectionDataPrivacy', 'Data & privacy') }}</h2>
          <div
            v-for="toggle in dataToggles"
            :key="toggle.id"
            class="toggle-row toggle-row-bordered"
          >
            <div>
              <div class="toggle-title">{{ toggle.title }}</div>
              <div class="toggle-desc">{{ toggle.desc }}</div>
            </div>
            <button
              type="button"
              class="toggle"
              :class="{ on: toggle.value }"
              :aria-pressed="toggle.value"
              @click="toggleDataItem(toggle.id)"
            >
              <span class="toggle-thumb" />
            </button>
          </div>
          <div class="panel-actions data-actions">
            <!-- HANDBOOK Download your school's data
                 section: seeing-progress
                 roles: school_admin, teacher
                 place: settings
                 keywords: export, download, csv, data, spreadsheet, report, records, progress
                 What it's for. Taking your school's progress figures out of the
                 app as a spreadsheet file — every student, the class they are in,
                 how far they have got, how long they have practised and when they
                 were last active.
                 Where it is. Settings, then Data & privacy, the button reading
                 **Download all data**.
                 How you do it.
                 1. Open Settings and choose Data & privacy.
                 2. Tap **Download all data**.
                 3. The file lands in your downloads, named after your school and
                    today's date.
                 4. Open it in any spreadsheet app to sort, filter or share it.
                 Worth knowing. It is a snapshot of the moment you press the
                 button, not a live link. Download it again whenever you need
                 current figures.
                 checked: da9d73ae.bdde1e52
            -->
            <button type="button" class="btn-ghost" data-walk="settings-export-data" :disabled="isExporting" @click="handleExportData">
              {{ isExporting ? t('schools.schoolSettings.preparing', 'Preparing…') : t('schools.schoolSettings.downloadAllData', 'Download all data (.csv)') }}
            </button>
          </div>

          <div v-if="canEditSchool" class="danger-zone">
            <h3 class="danger-zone-title">{{ t('schools.schoolSettings.dangerZone', 'Danger zone') }}</h3>
            <div class="toggle-row toggle-row-bordered">
              <div>
                <div class="toggle-title">{{ t('schools.schoolSettings.deleteThisSchool', 'Delete this school') }}</div>
                <div class="toggle-desc">{{ t('schools.schoolSettings.deleteThisSchoolDesc', 'Permanently deletes the school, its classes and enrolments. Cannot be undone.') }}</div>
              </div>
              <!-- HANDBOOK Delete your school
                   section: your-school
                   roles: school_admin
                   place: settings
                   keywords: delete, remove, close, school, danger, permanent, undo
                   What it's for. Closing your school down for good. It removes
                   the school itself along with its classes and everybody's
                   enrolment in them, and it cannot be undone.
                   Where it is. Settings, then Data & privacy, at the bottom
                   under Danger zone.
                   How you do it.
                   1. Open Settings and choose Data & privacy.
                   2. Scroll to Danger zone and tap **Delete school**.
                   3. Read what the app lists as going with it — classes,
                      students, teachers and recorded sessions are each counted
                      for you.
                   4. If the school has real activity in it, type the school's
                      name exactly to confirm you mean it.
                   5. Confirm. You are signed out to a clean slate, because the
                      account you were using belonged to a school that no longer
                      exists.
                   Worth knowing. Only your own school can be deleted this way,
                   and only by its admin. A school with nothing in it deletes
                   without the typed confirmation; one with students and sessions
                   always asks for it.
                   checked: 548d7ce1.1ba6f4b2
              -->
              <button type="button" class="btn-danger" data-walk="settings-delete-school" @click="openDeleteSchoolModal">{{ t('schools.schoolSettings.deleteSchool', 'Delete school') }}</button>
            </div>
          </div>
        </section>

        <!-- Billing is the WEB rail (platform/paymentRoute): its own component
             so a store build never compiles the seat-purchase markup. -->
        <SchoolBillingPanel
          v-else-if="activeSection === 'billing' && SchoolBillingPanel && seatPurchaseAvailable"
          :plan-line="planLine"
          :PRICE_PER_SEAT_GBP="PRICE_PER_SEAT_GBP"
          :is-subscribed="isSubscribed"
          :is-opening-portal="isOpeningPortal"
          :portal-error="portalError"
          @open-portal="openBillingPortal"
        />
      </div>
    </div>

    <ConfirmDeleteModal
      :is-open="showDeleteSchoolModal"
      :title="t('schools.schoolSettings.deleteSchool', 'Delete school')"
      :target-name="deleteSchoolImpact?.schoolName || activeSchool?.school_name || ''"
      :impact-lines="deleteSchoolImpactLines"
      :require-typed-confirm="!!deleteSchoolImpact?.hasRealActivity"
      :submitting="isDeletingSchool"
      :error="deleteSchoolError"
      @close="closeDeleteSchoolModal"
      @confirm="confirmDeleteSchool"
    />
  </main>
</template>

<style scoped>
.settings-screen {
  padding: 22px 28px 32px;
  max-width: 1080px;
  margin: 0 auto;
}

.page-title {
  font-size: 30px;
  line-height: 1.05;
  margin-bottom: 14px;
}

.settings-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 18px;
  align-items: start;
}

.section-nav {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 70px;
}

.section-link {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--schools-fg);
  font-family: var(--font-body);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease-out, color 120ms ease-out;
}

.section-link:hover {
  background: #f6f5f1;
}

.section-link.active {
  background: #f6f5f1;
  color: var(--schools-red);
  font-weight: 600;
}

.settings-content {
  min-width: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
}

.panel-title {
  font-size: 22px;
  margin: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.field-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--schools-fg);
}

.field-hint {
  font-size: 11.5px;
  color: var(--schools-fg-2);
}

.field-input {
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--schools-border-strong);
  border-radius: 8px;
  background: #fff;
  font-family: var(--font-body);
  color: var(--schools-fg);
}

.field-input:focus {
  outline: none;
  border-color: var(--schools-red);
  box-shadow: 0 0 0 3px rgba(219, 30, 23, 0.12);
}

.field-input[readonly] {
  background: #fafaf6;
  color: var(--schools-fg-2);
}

.field-textarea {
  resize: vertical;
  min-height: 76px;
  font-family: var(--font-body);
}

.panel-actions {
  display: flex;
  gap: 8px;
  padding-top: 6px;
}

.portal-error {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--ssi-red, #c23a3a);
}

.data-actions {
  padding-top: 8px;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 0;
}

.toggle-row-bordered {
  border-top: 1px solid var(--schools-border);
  padding: 10px 0;
}

.toggle-title {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--schools-fg);
}

.toggle-desc {
  font-size: 12px;
  color: var(--schools-fg-2);
  margin-top: 2px;
  max-width: 380px;
  line-height: 1.5;
}

.danger-zone {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--schools-border);
}

.danger-zone-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ssi-red, #c23a3a);
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.btn-danger {
  padding: 10px 16px;
  border-radius: 10px;
  background: transparent;
  border: 1px solid var(--ssi-red, #c23a3a);
  color: var(--ssi-red, #c23a3a);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.btn-danger:hover {
  background: var(--ssi-red, #c23a3a);
  color: white;
}

.toggle {
  width: 42px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: #ccc;
  position: relative;
  cursor: pointer;
  flex: none;
  padding: 0;
  transition: background 160ms ease-out;
}

.toggle.on {
  background: var(--schools-success);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: left 150ms ease-out;
}

.toggle.on .toggle-thumb {
  left: 20px;
}

.plan-card {
  padding: 14px;
  background: #fdf6df;
  border: 1px solid #f0d97a;
  border-radius: 8px;
}

.plan-kicker {
  color: #7a5418;
}

.plan-title {
  font-size: 24px;
  margin-top: 4px;
  color: #4a3308;
}

.plan-meta {
  font-size: 12.5px;
  color: #5a3e10;
  margin-top: 4px;
}

@media (max-width: 960px) {
  .settings-screen {
    padding: 20px 16px 32px;
  }

  .settings-layout {
    grid-template-columns: 1fr;
  }

  .section-nav {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    gap: 4px;
  }

  .section-link {
    flex: none;
    padding: 8px 12px;
  }

  .field-row {
    grid-template-columns: 1fr;
  }
}

.identity-panel .identity-group { margin-top: 14px; }
.identity-list { list-style: none; margin: 6px 0 8px; padding: 0; }
.identity-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle, #e2ded9); }
.identity-value { font-size: 14px; }
.identity-empty { font-size: 13px; color: var(--text-secondary, #47556a); padding: 6px 0; }
.identity-add { display: flex; gap: 8px; align-items: center; }
.identity-add .field-input { flex: 1; min-width: 0; }
.identity-error { color: var(--accent-danger, #b3261e); margin-top: 10px; }
.identity-remove { font-size: 13px; }
</style>
