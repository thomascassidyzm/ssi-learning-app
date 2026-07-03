import { describe, it, expect } from 'vitest';
import { canAccessSeed, checkCourseAccess } from './access';
import { BELT_MAX_SEEDS, PREMIUM_PREVIEW_MAX_SEED } from './types';

const PREMIUM_COURSE = { course_code: 'spa_for_eng', pricing_tier: 'premium' as const, is_community: false };

describe('canAccessSeed — the shared gate behind both the stepper and the belt-picker jump', () => {
  it('blocks a signed-out guest jumping straight to a belt past the free-preview wall (the belt-picker bug)', () => {
    // Orange belt starts right after the Yellow-belt preview ceiling — this is
    // exactly the kind of jump the belt-picker modal fires (skip the stepper
    // entirely and land deep in premium content).
    const orangeBeltFirstSeed = BELT_MAX_SEEDS.yellow + 1;
    expect(canAccessSeed(PREMIUM_COURSE, null, orangeBeltFirstSeed)).toBe(false);
  });

  it('allows the guest to preview through the Yellow-belt boundary', () => {
    expect(canAccessSeed(PREMIUM_COURSE, null, PREMIUM_PREVIEW_MAX_SEED)).toBe(true);
  });

  it('allows a subscribed learner to jump anywhere, picker or stepper alike', () => {
    const subscribed = { isActive: true, tier: 'paid' as const };
    expect(canAccessSeed(PREMIUM_COURSE, subscribed, BELT_MAX_SEEDS.black)).toBe(true);
  });

  it('never gates free or community courses', () => {
    expect(canAccessSeed({ course_code: 'cym_for_eng', pricing_tier: 'free', is_community: false }, null, 9999)).toBe(true);
    expect(canAccessSeed({ course_code: 'community_xyz', pricing_tier: 'community', is_community: true }, null, 9999)).toBe(true);
  });

  it('reports preview_only with the correct limit for a guest on a premium course', () => {
    const access = checkCourseAccess(PREMIUM_COURSE, null);
    expect(access.canAccess).toBe(false);
    expect(access.canPreview).toBe(true);
    expect(access.previewMaxSeed).toBe(PREMIUM_PREVIEW_MAX_SEED);
  });
});
