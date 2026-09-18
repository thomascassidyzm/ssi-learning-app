<script setup lang="ts">
/**
 * SchoolVouchCard — an admin's "I know this school is real".
 *
 * TOM'S RULING 1 (job #195, 2026-09-18): an unproven school "can build but
 * not enrol ... until the mailbox is proven or an admin vouches." A school
 * founded through the no-code door whose head has not yet confirmed a
 * mailbox holds every pupil code. This card is the other way out: shown on
 * the ADMIN read-view of a school, only when /api/school/vouch says the
 * school is held, one button, and the founder's own banner stays until the
 * code lands. Never on the member surface — the founder cannot vouch for
 * herself, and the server refuses her by id anyway.
 */
import { ref, onMounted, watch } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { useAdminClient } from '@/composables/useAdminClient'

const props = defineProps<{ schoolId: string }>()
const { t } = useI18n()
const { getAuthToken } = useAdminClient()

const held = ref(false)
const busy = ref(false)
const done = ref(false)
const error = ref('')

async function load() {
  held.value = false
  done.value = false
  error.value = ''
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/school/vouch?school_id=${encodeURIComponent(props.schoolId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!resp.ok) return
    const body = await resp.json().catch(() => ({}))
    held.value = body?.held === true
  } catch {
    /* a card that cannot be read is simply not shown */
  }
}

async function vouch() {
  busy.value = true
  error.value = ''
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/school/vouch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ school_id: props.schoolId }),
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      error.value = t('org.nodeHome.vouchFailed', "Couldn't record that. Try again.")
      return
    }
    if (body?.vouched === true || body?.already_open === true) {
      done.value = true
      held.value = false
    }
  } catch {
    error.value = t('org.nodeHome.vouchFailed', "Couldn't record that. Try again.")
  } finally {
    busy.value = false
  }
}

onMounted(load)
watch(() => props.schoolId, load)
</script>

<template>
  <section v-if="held || done" class="vouch-card">
    <h3 class="vouch-card__title">{{ t('org.nodeHome.vouchTitle', 'Pupils are on hold at this school') }}</h3>
    <p v-if="done" class="vouch-card__done">{{ t('org.nodeHome.vouchDone', 'Vouched. Pupils can join now.') }}</p>
    <template v-else>
      <p class="vouch-card__body">
        {{ t('org.nodeHome.vouchBody', "It was set up without a code and its email address is not confirmed yet, so no pupil can join. If you know this school is real, vouch for it and its class links go live. The founder's strip stays until the code lands.") }}
      </p>
      <!-- HANDBOOK Vouch for a school whose email is not yet confirmed
           section: getting-people-in
           moment: something-wrong
           roles: admin, leader
           place: dashboard
           keywords: vouch, hold, pupils, unconfirmed, school, email, join code
           What it's for. Letting pupils join a school that was set up without
           a code before its email address has been confirmed, because you
           know the school is real.
           Where it is. The school's page, a card headed **Pupils are on hold
           at this school**, shown only while that is true.
           How you do it.
           1. Open the school.
           2. Tap **Vouch for this school**.
           Worth knowing. The head's own confirmation strip stays until their
           code lands. A school cannot vouch for itself.
           checked: 625b2ad0.a707613c
      -->
      <button type="button" class="vouch-card__btn" data-walk="school-vouch-button" :disabled="busy" @click="vouch">
        {{ t('org.nodeHome.vouchButton', 'Vouch for this school') }}
      </button>
      <p v-if="error" class="vouch-card__error" role="alert">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
.vouch-card {
  margin: 16px 0;
  padding: 14px 16px;
  border: 1px solid rgba(60, 90, 140, 0.25);
  border-radius: 12px;
  background: #eef3fb;
  color: #24395c;
}
.vouch-card__title { margin: 0 0 6px; font-size: 15px; font-weight: 700; }
.vouch-card__body { margin: 0 0 10px; font-size: 14px; line-height: 1.45; }
.vouch-card__done { margin: 0; font-weight: 600; color: #1f6b3a; }
.vouch-card__btn {
  padding: 8px 14px;
  border: 0;
  border-radius: 8px;
  background: #24395c;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.vouch-card__btn:disabled { opacity: 0.6; cursor: default; }
.vouch-card__error { margin: 8px 0 0; color: #8a2a1e; font-size: 13px; }
</style>
