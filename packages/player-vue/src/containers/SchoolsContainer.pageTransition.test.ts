import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// White-page-of-death regression (2026-07-16): a govt admin client-side
// navigating Analytics -> Schools got a blank page below the top bar until
// a hard reload. Root cause, confirmed by instrumenting Vue's own
// BaseTransition internals: <transition mode="out-in"> defers mounting the
// incoming route component until a leave-completion callback
// (afterLeave -> instance.update()) fires. Leaving TeacherInsightsView
// (the /schools/analytics route) that callback never ran — the CSS leave
// itself completed (the @after-leave DOM event fired) but the internal
// "now reveal the next page" hook was never invoked, so router-view stayed
// on an empty placeholder forever. A plain crossfade (no mode) has no such
// dependency: enter and leave just run in parallel, so there is nothing to
// get stuck waiting on.
//
// This can't be caught with a real behavioural mount test: jsdom/happy-dom
// report a zero-length CSS transition duration, so Vue's transition
// resolves on the next animation frame regardless of `mode` — the race that
// broke this in a real browser doesn't reproduce under a fake DOM. Guard
// the fix at the source level instead: mode="out-in" must never come back
// on the schools shell's routed-page transition.
describe('SchoolsContainer page transition', () => {
  it('does not use mode="out-in" on the routed-page transition', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/containers/SchoolsContainer.vue'),
      'utf-8',
    )
    const transitionBlockMatch = source.match(/<transition\b[^>]*>[\s\S]*?<component :is="Component" \/>/)
    expect(transitionBlockMatch, 'expected to find the router-view <transition> wrapping <component :is="Component">').toBeTruthy()
    expect(transitionBlockMatch![0]).not.toMatch(/mode="out-in"/)
  })
})
