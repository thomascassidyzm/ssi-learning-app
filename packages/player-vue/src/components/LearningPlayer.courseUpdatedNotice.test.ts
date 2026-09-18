import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Tom, 2026-09-17: the "Your course was updated" notice rendered beneath the
// Easy/Fast selector on staging and could not be read. It shared the plain
// .mode-tip bottom-strip position, which .belt-waiting-tip was moved out of
// for the same reason on 2026-09-06. Scoped-CSS geometry isn't observable in
// jsdom, so this asserts the source rule directly: the notice must sit
// outside the bottom strip (no bottom-anchored position) and above every
// overlay the player can draw (z-index > the paywall/offline-picker stack,
// topping out at 3100).
const source = readFileSync(join(process.cwd(), 'src/components/LearningPlayer.vue'), 'utf8')

function extractRule(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([\\s\\S]*?)\\}`)
  const match = source.match(pattern)
  if (!match) throw new Error(`Missing CSS rule for ${selector}`)
  return match[1]
}

describe('course-updated-notice placement', () => {
  it('is not anchored to the bottom strip where Easy/Fast and the belt pill live', () => {
    const rule = extractRule('.course-updated-notice')
    expect(rule).not.toMatch(/bottom:\s*calc\(var\(--nav-height-safe/)
    expect(rule).toMatch(/top:\s*max\(/)
  })

  it('layers above every overlay the player can draw (offline picker at 3100)', () => {
    const rule = extractRule('.course-updated-notice')
    const zIndexMatch = rule.match(/z-index:\s*(\d+)/)
    expect(zIndexMatch).not.toBeNull()
    expect(Number(zIndexMatch![1])).toBeGreaterThan(3100)
  })
})
