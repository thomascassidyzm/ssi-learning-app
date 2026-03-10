/**
 * Console dedup — suppresses consecutive identical messages after 3 repeats.
 *
 * Install once in App.vue's <script setup> with `installConsoleDedup()`.
 */

const MAX_REPEATS = 3

let lastMessage = ''
let repeatCount = 0

function dedup(
  original: (...args: unknown[]) => void,
  args: unknown[],
): boolean {
  const message = args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')

  if (message === lastMessage) {
    repeatCount++
    if (repeatCount === MAX_REPEATS + 1) {
      original(`[suppressed — same message repeated, showing no more]`)
    }
    return repeatCount > MAX_REPEATS
  }

  lastMessage = message
  repeatCount = 1
  return false
}

export function installConsoleDedup(): void {
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)

  console.error = (...args: unknown[]) => {
    if (!dedup(origError, args)) origError(...args)
  }
  console.warn = (...args: unknown[]) => {
    if (!dedup(origWarn, args)) origWarn(...args)
  }
}
