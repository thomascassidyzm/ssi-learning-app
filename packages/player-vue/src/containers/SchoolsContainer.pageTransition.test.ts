import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Schools routed-page swap: two real-browser bug classes came from animating
// it, so the invariant is now NO transition at all (2026-07-16):
//
//  1. <transition mode="out-in"> deferred mounting the incoming page behind
//     a leave-completion callback (BaseTransition's afterLeave ->
//     instance.update()) that reliably never fired leaving
//     /schools/analytics — blank page until hard reload.
//  2. The plain crossfade that replaced it kept BOTH pages in normal flow at
//     once, so the incoming page rendered stacked BELOW the leaving one
//     (measured at y≈500-870px in an 800px viewport, i.e. partly off-screen)
//     for the fade duration, then snapped to the top when the old page
//     unmounted — the "part-loaded at the bottom, then jumps" report.
//
// Neither reproduces under jsdom/happy-dom (zero-length CSS transitions make
// every mode resolve on the next frame), so the invariant is guarded at
// source level; the behavioural proof lives in the real-browser nav
// stress-run (repro/ harness, 2026-07-16).
describe('SchoolsContainer routed-page swap', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/containers/SchoolsContainer.vue'),
    'utf-8',
  )

  it('renders the routed component with NO <transition> wrapper (instant swap)', () => {
    const routerViewBlock = source.match(/<router-view v-slot="\{ Component \}">[\s\S]*?<\/router-view>/)
    expect(routerViewBlock, 'expected the v-slot router-view block').toBeTruthy()
    expect(routerViewBlock![0]).not.toMatch(/<transition\b/i)
    // And no Transition import sneaking back in via script.
    expect(source).not.toMatch(/<transition\b[^>]*>\s*<component :is="Component"/i)
  })

  it('resets the schools scroll container to top on route change (render in place)', () => {
    // The surface scrolls inside .schools-container, not the window, so the
    // router's global scrollBehavior cannot do this — the container must.
    expect(source).toMatch(/containerEl\.value\.scrollTop = 0/)
    expect(source).toMatch(/ref="containerEl"/)
  })
})
