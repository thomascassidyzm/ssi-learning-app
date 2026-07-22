import { ref, watch, onUnmounted, type Ref } from 'vue'

/**
 * Drives the pod-listening reminder's one-shot transient: visible for
 * `holdMs` from the moment a pod lap starts, then hidden — never persists
 * for the lap's full duration (that was the bug: a persistent panel sat
 * above PodTurnDisplay and covered the dialogue tiles on long pods).
 * Re-arms every time `playingPodLapAudio` goes false→true, i.e. once per
 * pod lap. Going true→false mid-hold (lap ends/cancelled early) hides it
 * immediately rather than leaving it stranded on screen.
 */
export function usePodListeningReminder(playingPodLapAudio: Ref<boolean>, holdMs = 4000) {
  const visible = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  watch(playingPodLapAudio, (isPlaying) => {
    clearTimer()
    if (isPlaying) {
      visible.value = true
      timer = setTimeout(() => { visible.value = false }, holdMs)
    } else {
      visible.value = false
    }
  })

  onUnmounted(clearTimer)

  return { visible }
}
