/**
 * useResendCooldown — Resend stays down for a while after any send, and says
 * why (auth/codeSupersession.ts). One ticking counter, shared shape for every
 * code screen. `start()` after every send, including the first; `canResend`
 * gates the button; `secondsLeft` feeds the label.
 */
import { computed, onUnmounted, ref } from 'vue'
import { RESEND_COOLDOWN_MS } from '@/auth/codeSupersession'

export function useResendCooldown(cooldownMs: number = RESEND_COOLDOWN_MS) {
  const until = ref(0)
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  function start(at: number = Date.now()) {
    until.value = at + cooldownMs
    now.value = at
    stop()
    timer = setInterval(() => {
      now.value = Date.now()
      if (now.value >= until.value) stop()
    }, 1000)
  }

  /** Forget the cooldown — a change of address is a fresh start. */
  function reset() {
    until.value = 0
    stop()
  }

  const secondsLeft = computed(() => Math.max(0, Math.ceil((until.value - now.value) / 1000)))
  const canResend = computed(() => secondsLeft.value === 0)

  onUnmounted(stop)

  return { start, reset, secondsLeft, canResend }
}
