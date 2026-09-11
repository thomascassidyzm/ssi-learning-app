import { describe, it, expect } from 'vitest'
import { exclusionReasons } from './person'

// Question 6 states the population rule for ONE person: in the numbers, or
// every reason they are not — so a page about a demo account can never look
// like a page about a customer.
describe("one person's standing in the numbers", () => {
  it('names every reason a person is out', () => {
    expect(exclusionReasons({ is_demo: true, is_internal: true, is_class_entity: false, platform_role: 'tester' }, true))
      .toEqual(['demo', 'internal', 'staff-role'])
    expect(exclusionReasons({ is_demo: false, is_internal: false, is_class_entity: true, platform_role: null }, false))
      .toEqual(['class-account'])
  })

  it('attributes the canonical set to a test school or address when the flags do not explain it', () => {
    expect(exclusionReasons({ is_demo: false, is_internal: false, is_class_entity: false, platform_role: null }, true))
      .toEqual(['test-school-or-address'])
    expect(exclusionReasons({ is_demo: false, is_internal: false, is_class_entity: false, platform_role: null }, false))
      .toEqual([])
  })
})
