/**
 * useFamilyModal — module-level open/close for the ONE family-management
 * surface (components/FamilyManagementModal.vue).
 *
 * WHY: the modal used to be owned by a `ref` inside SettingsScreen, so the
 * only way to reach it was Settings → Subscription → Manage family. Tom paid
 * for six seats and was dropped on a course list with nothing about the family
 * he had just bought (2026-09-07). The payer now lands on it directly, off the
 * Paddle success redirect (`/?family=1`).
 *
 * The modal itself is unchanged and there is still exactly one of it: it moved
 * up to App.vue (next to PlanPicker and CheckoutOverlay, the other two pieces
 * of the purchase flow), and Settings opens it through here rather than owning
 * it. Same surface, two doors.
 */
import { ref, readonly } from 'vue'

const isOpen = ref(false)

export function openFamilyModal(): void {
  isOpen.value = true
}

export function closeFamilyModal(): void {
  isOpen.value = false
}

export function useFamilyModal() {
  return {
    isOpen: readonly(isOpen),
    open: openFamilyModal,
    close: closeFamilyModal,
  }
}
