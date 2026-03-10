/**
 * Console dedup — suppresses consecutive similar messages after 3 repeats.
 *
 * "Similar" = same prefix up to the first variable part (e.g. ID, number).
 * This catches both exact repeats AND pattern repeats like:
 *   "[foo] Bar for ABC123 failed"
 *   "[foo] Bar for DEF456 failed"
 *
 * Install once in App.vue's <script setup> with `installConsoleDedup()`.
 */

const MAX_REPEATS = 3

let lastPrefix = ''
let repeatCount = 0

/**
 * Extract a "signature" from a message by replacing variable parts
 * (UUIDs, hex strings, numbers, LEGO keys like S0001L02) with placeholders.
 */
function getSignature(message: string): string {
  return message
    .replace(/S\d{3,4}L\d{2}/g, 'S####L##')        // LEGO keys
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}/gi, '<uuid>') // UUID prefixes
    .replace(/\b\d{2,}\b/g, '#')                     // Numbers (2+ digits)
}

function dedup(
  original: (...args: unknown[]) => void,
  args: unknown[],
): boolean {
  const message = args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ')

  const sig = getSignature(message)

  if (sig === lastPrefix) {
    repeatCount++
    if (repeatCount === MAX_REPEATS + 1) {
      original(`[suppressed — similar message repeated, showing no more]`)
    }
    return repeatCount > MAX_REPEATS
  }

  lastPrefix = sig
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
