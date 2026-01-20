<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { getClient } from '@/composables/useSupabase'
import { useGodMode } from '@/composables/useGodMode'

type EntityType = 'govt_admin' | 'school' | 'teacher' | 'student'

const props = defineProps<{
  show: boolean
  entityType: EntityType
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', entity: any): void
}>()

const { selectedUser } = useGodMode()
const client = getClient()

// Form state
const isSubmitting = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

// Form fields
const formData = ref({
  // Govt Admin fields
  govtName: '',
  govtEmail: '',
  govtRegion: '',
  govtOrganization: '',

  // School fields
  schoolName: '',
  schoolAdminEmail: '',
  schoolRegion: '',

  // Teacher fields
  teacherName: '',
  teacherEmail: '',
  teacherJoinCode: '',

  // Student fields
  studentName: '',
  studentEmail: '',
  studentJoinCode: '',
  studentClass: ''
})

// Reset form when modal opens/closes
watch(() => props.show, (newVal) => {
  if (newVal) {
    resetForm()
  }
})

function resetForm() {
  formData.value = {
    govtName: '',
    govtEmail: '',
    govtRegion: '',
    govtOrganization: '',
    schoolName: '',
    schoolAdminEmail: '',
    schoolRegion: '',
    teacherName: '',
    teacherEmail: '',
    teacherJoinCode: '',
    studentName: '',
    studentEmail: '',
    studentJoinCode: '',
    studentClass: ''
  }
  error.value = null
  success.value = false
}

// Modal title based on entity type
const modalTitle = computed(() => {
  switch (props.entityType) {
    case 'govt_admin': return 'Add Government Admin'
    case 'school': return 'Add School'
    case 'teacher': return 'Add Teacher'
    case 'student': return 'Add Student'
    default: return 'Add Entity'
  }
})

// Generate a random join code
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// Generate a simple user ID
function generateUserId(): string {
  return `user_2bre_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Submit handlers for each entity type
async function handleSubmit() {
  isSubmitting.value = true
  error.value = null

  try {
    switch (props.entityType) {
      case 'govt_admin':
        await createGovtAdmin()
        break
      case 'school':
        await createSchool()
        break
      case 'teacher':
        await createTeacher()
        break
      case 'student':
        await createStudent()
        break
    }
    success.value = true
    setTimeout(() => {
      emit('close')
    }, 1500)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'An error occurred'
  } finally {
    isSubmitting.value = false
  }
}

async function createGovtAdmin() {
  if (!formData.value.govtName || !formData.value.govtEmail || !formData.value.govtRegion) {
    throw new Error('Please fill in all required fields')
  }

  const userId = generateUserId()

  // Create learner record
  const { error: learnerError } = await client
    .from('learners')
    .insert({
      user_id: userId,
      display_name: formData.value.govtName,
      educational_role: 'govt_admin'
    })

  if (learnerError) throw learnerError

  // Create govt_admins record
  const { error: govtError } = await client
    .from('govt_admins')
    .insert({
      user_id: userId,
      region_code: formData.value.govtRegion,
      organization_name: formData.value.govtOrganization || null
    })

  if (govtError) throw govtError

  emit('created', { type: 'govt_admin', name: formData.value.govtName })
}

async function createSchool() {
  if (!formData.value.schoolName || !formData.value.schoolRegion) {
    throw new Error('Please fill in all required fields')
  }

  const teacherJoinCode = generateJoinCode()

  // Create school record
  const { data: school, error: schoolError } = await client
    .from('schools')
    .insert({
      school_name: formData.value.schoolName,
      region_code: formData.value.schoolRegion,
      teacher_join_code: teacherJoinCode
    })
    .select()
    .single()

  if (schoolError) throw schoolError

  // If admin email provided, create admin learner
  if (formData.value.schoolAdminEmail) {
    const userId = generateUserId()

    // Create learner record for admin
    const { error: learnerError } = await client
      .from('learners')
      .insert({
        user_id: userId,
        display_name: formData.value.schoolAdminEmail.split('@')[0],
        educational_role: 'school_admin'
      })

    if (learnerError) throw learnerError

    // Create user_tag linking admin to school
    await client
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'school',
        tag_value: `SCHOOL:${school.id}`,
        role_in_context: 'admin'
      })
  }

  emit('created', { type: 'school', name: formData.value.schoolName, joinCode: teacherJoinCode })
}

async function createTeacher() {
  // If using join code
  if (formData.value.teacherJoinCode) {
    // Look up school by join code
    const { data: school, error: lookupError } = await client
      .from('schools')
      .select('id, school_name')
      .eq('teacher_join_code', formData.value.teacherJoinCode)
      .single()

    if (lookupError || !school) {
      throw new Error('Invalid join code')
    }

    const userId = generateUserId()
    const teacherName = formData.value.teacherName || 'New Teacher'

    // Create learner record
    const { error: learnerError } = await client
      .from('learners')
      .insert({
        user_id: userId,
        display_name: teacherName,
        educational_role: 'teacher'
      })

    if (learnerError) throw learnerError

    // Create user_tag linking teacher to school
    await client
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'school',
        tag_value: `SCHOOL:${school.id}`,
        role_in_context: 'teacher'
      })

    emit('created', { type: 'teacher', name: teacherName, school: school.school_name })
    return
  }

  // Manual creation (requires school admin context)
  if (!selectedUser.value?.school_id) {
    throw new Error('No school context available')
  }

  if (!formData.value.teacherName || !formData.value.teacherEmail) {
    throw new Error('Please fill in all required fields')
  }

  const userId = generateUserId()

  // Create learner record
  const { error: learnerError } = await client
    .from('learners')
    .insert({
      user_id: userId,
      display_name: formData.value.teacherName,
      educational_role: 'teacher'
    })

  if (learnerError) throw learnerError

  // Create user_tag linking teacher to school
  await client
    .from('user_tags')
    .insert({
      user_id: userId,
      tag_type: 'school',
      tag_value: `SCHOOL:${selectedUser.value.school_id}`,
      role_in_context: 'teacher'
    })

  emit('created', { type: 'teacher', name: formData.value.teacherName })
}

async function createStudent() {
  // If using join code
  if (formData.value.studentJoinCode) {
    // Look up class by join code
    const { data: classData, error: lookupError } = await client
      .from('classes')
      .select('id, class_name')
      .eq('student_join_code', formData.value.studentJoinCode)
      .single()

    if (lookupError || !classData) {
      throw new Error('Invalid join code')
    }

    const userId = generateUserId()
    const studentName = formData.value.studentName || 'New Student'

    // Create learner record
    const { error: learnerError } = await client
      .from('learners')
      .insert({
        user_id: userId,
        display_name: studentName,
        educational_role: 'student'
      })

    if (learnerError) throw learnerError

    // Create user_tag linking student to class
    await client
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'class',
        tag_value: `CLASS:${classData.id}`,
        role_in_context: 'student'
      })

    emit('created', { type: 'student', name: studentName, class: classData.class_name })
    return
  }

  // Manual creation (requires class selection)
  if (!formData.value.studentClass) {
    throw new Error('Please select a class or enter a join code')
  }

  if (!formData.value.studentName) {
    throw new Error('Please enter student name')
  }

  const userId = generateUserId()

  // Create learner record
  const { error: learnerError } = await client
    .from('learners')
    .insert({
      user_id: userId,
      display_name: formData.value.studentName,
      educational_role: 'student'
    })

  if (learnerError) throw learnerError

  // Create user_tag linking student to class
  await client
    .from('user_tags')
    .insert({
      user_id: userId,
      tag_type: 'class',
      tag_value: `CLASS:${formData.value.studentClass}`,
      role_in_context: 'student'
    })

  emit('created', { type: 'student', name: formData.value.studentName })
}

function handleClose() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="handleClose">
        <div class="modal">
          <div class="modal-header">
            <h2 class="modal-title">{{ modalTitle }}</h2>
            <button class="modal-close" @click="handleClose">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div class="modal-body">
            <!-- Success State -->
            <div v-if="success" class="success-state">
              <div class="success-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
              </div>
              <h3>Created Successfully!</h3>
              <p>The {{ entityType.replace('_', ' ') }} has been added.</p>
            </div>

            <!-- Error State -->
            <div v-if="error" class="error-banner">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {{ error }}
            </div>

            <!-- Govt Admin Form -->
            <template v-if="!success && entityType === 'govt_admin'">
              <div class="form-group">
                <label class="form-label">Full Name *</label>
                <input
                  v-model="formData.govtName"
                  type="text"
                  class="form-input"
                  placeholder="e.g., Jean Dupont"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Email Address *</label>
                <input
                  v-model="formData.govtEmail"
                  type="email"
                  class="form-input"
                  placeholder="e.g., jean.dupont@region-bretagne.fr"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Region Code *</label>
                <input
                  v-model="formData.govtRegion"
                  type="text"
                  class="form-input"
                  placeholder="e.g., brittany"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Organization</label>
                <input
                  v-model="formData.govtOrganization"
                  type="text"
                  class="form-input"
                  placeholder="e.g., Region Bretagne Education"
                />
              </div>
            </template>

            <!-- School Form -->
            <template v-if="!success && entityType === 'school'">
              <div class="form-group">
                <label class="form-label">School Name *</label>
                <input
                  v-model="formData.schoolName"
                  type="text"
                  class="form-input"
                  placeholder="e.g., Lycee Saint-Brieuc"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Region Code *</label>
                <input
                  v-model="formData.schoolRegion"
                  type="text"
                  class="form-input"
                  placeholder="e.g., brittany"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Admin Email (Optional)</label>
                <input
                  v-model="formData.schoolAdminEmail"
                  type="email"
                  class="form-input"
                  placeholder="e.g., admin@school.edu"
                />
                <p class="form-hint">If provided, a school admin account will be created</p>
              </div>
            </template>

            <!-- Teacher Form -->
            <template v-if="!success && entityType === 'teacher'">
              <div class="form-tabs">
                <div class="tab-hint">Enter a join code or add manually</div>
              </div>

              <div class="form-group">
                <label class="form-label">Teacher Join Code</label>
                <input
                  v-model="formData.teacherJoinCode"
                  type="text"
                  class="form-input code-input"
                  placeholder="e.g., ABC123"
                  maxlength="6"
                />
                <p class="form-hint">Get this code from your school administrator</p>
              </div>

              <div class="form-divider">
                <span>or add manually</span>
              </div>

              <div class="form-group">
                <label class="form-label">Teacher Name</label>
                <input
                  v-model="formData.teacherName"
                  type="text"
                  class="form-input"
                  placeholder="e.g., Marie Martin"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Email Address</label>
                <input
                  v-model="formData.teacherEmail"
                  type="email"
                  class="form-input"
                  placeholder="e.g., m.martin@school.edu"
                />
              </div>
            </template>

            <!-- Student Form -->
            <template v-if="!success && entityType === 'student'">
              <div class="form-tabs">
                <div class="tab-hint">Enter a join code or add manually</div>
              </div>

              <div class="form-group">
                <label class="form-label">Student Join Code</label>
                <input
                  v-model="formData.studentJoinCode"
                  type="text"
                  class="form-input code-input"
                  placeholder="e.g., XYZ789"
                  maxlength="6"
                />
                <p class="form-hint">Get this code from your teacher</p>
              </div>

              <div class="form-divider">
                <span>or add manually</span>
              </div>

              <div class="form-group">
                <label class="form-label">Student Name</label>
                <input
                  v-model="formData.studentName"
                  type="text"
                  class="form-input"
                  placeholder="e.g., Pierre Leroy"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Email Address</label>
                <input
                  v-model="formData.studentEmail"
                  type="email"
                  class="form-input"
                  placeholder="e.g., p.leroy@student.edu"
                />
              </div>
            </template>
          </div>

          <div v-if="!success" class="modal-footer">
            <button class="btn btn-secondary" @click="handleClose" :disabled="isSubmitting">
              Cancel
            </button>
            <button class="btn btn-primary" @click="handleSubmit" :disabled="isSubmitting">
              <template v-if="isSubmitting">
                <span class="spinner"></span>
                Creating...
              </template>
              <template v-else>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Create {{ entityType.replace('_', ' ') }}
              </template>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 20px;
}

.modal {
  background: var(--bg-card);
  border: 1px solid var(--border-medium);
  border-radius: 22px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  padding: 24px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: var(--error);
  color: white;
}

.modal-body {
  padding: 24px;
}

/* Success State */
.success-state {
  text-align: center;
  padding: 32px 16px;
}

.success-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 20px;
  background: rgba(74, 222, 128, 0.15);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--success);
}

.success-state h3 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.success-state p {
  color: var(--text-secondary);
}

/* Error Banner */
.error-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid var(--error);
  border-radius: 12px;
  color: var(--error);
  font-size: 14px;
  margin-bottom: 20px;
}

/* Form Groups */
.form-group {
  margin-bottom: 20px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-input {
  width: 100%;
  padding: 14px 18px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  transition: all 0.2s ease;
}

.form-input::placeholder {
  color: var(--text-muted);
}

.form-input:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

.form-input.code-input {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 18px;
  letter-spacing: 4px;
  text-transform: uppercase;
  text-align: center;
}

.form-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.form-tabs {
  margin-bottom: 20px;
}

.tab-hint {
  font-size: 14px;
  color: var(--text-secondary);
  text-align: center;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.form-divider {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 24px 0;
  color: var(--text-muted);
  font-size: 13px;
}

.form-divider::before,
.form-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

/* Modal Footer */
.modal-footer {
  padding: 24px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 13px 22px;
  border-radius: 12px;
  border: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--ssi-red);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--ssi-red-light);
  box-shadow: 0 0 32px rgba(194, 58, 58, 0.35);
  transform: translateY(-2px);
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-medium);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-elevated);
  border-color: var(--ssi-red);
}

/* Spinner */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Modal Transition */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: translateY(20px) scale(0.95);
}

/* Responsive */
@media (max-width: 480px) {
  .modal {
    border-radius: 18px 18px 0 0;
    max-height: 85vh;
    margin-top: auto;
  }

  .modal-footer {
    flex-direction: column;
  }

  .btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
