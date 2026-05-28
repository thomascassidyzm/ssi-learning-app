/**
 * Act-as personas — the fixed set of demo identities an ssi_admin can step
 * into to experience the schools app as a teacher / school leader / group
 * admin. These point at the Wales demo data (Demo subtree, isolated from any
 * real school), so acting-as is always safe to thrash.
 *
 * One per role is intentionally enough: the goal is "what does it look like
 * for an actual person", not coverage of every school. Add more here if a
 * second instance of a role is ever needed.
 */
import type { ActAsPersona } from '@/composables/useUserRole'

export const ACT_AS_PERSONAS: ActAsPersona[] = [
  {
    key: 'teacher',
    userId: 'test_teacher_rhian',
    role: 'teacher',
    name: 'Rhian Griffiths',
  },
  {
    key: 'school_admin',
    userId: 'test_admin_elen',
    role: 'school_admin',
    name: 'Elen Rhys',
  },
  {
    key: 'govt_admin',
    userId: 'test_govt_gwilym',
    role: 'govt_admin',
    name: 'Gwilym ap Dafydd',
  },
]

/** Human label for a persona's role, for buttons and the act-as banner. */
export function roleLabel(role: ActAsPersona['role']): string {
  switch (role) {
    case 'teacher':
      return 'Teacher'
    case 'school_admin':
      return 'School leader'
    case 'govt_admin':
      return 'Group admin'
  }
}
