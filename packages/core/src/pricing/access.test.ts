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

  it('optimistically allows a jump past the preview wall while subscription status is still hydrating (morgan1009 bug, 2026-07-04)', () => {
    // Authenticated learner whose real subscription hasn't been fetched yet
    // (fresh load, or right after ?reset=1 wiped the local cache) must NOT be
    // treated as unsubscribed — that false negative is what booted an active
    // Paddle subscriber back to the free preview / infinite play.
    const pending = { isActive: false, tier: 'free' as const, isPending: true };
    expect(canAccessSeed(PREMIUM_COURSE, pending, BELT_MAX_SEEDS.black)).toBe(true);
    const access = checkCourseAccess(PREMIUM_COURSE, pending);
    expect(access.canAccess).toBe(true);
    expect(access.upgradeRequired).toBe(false);
  });

  it('still gates a resolved non-subscriber (isPending false) past the preview wall', () => {
    const resolved = { isActive: false, tier: 'free' as const, isPending: false };
    expect(canAccessSeed(PREMIUM_COURSE, resolved, BELT_MAX_SEEDS.black)).toBe(false);
  });

  it('honours a class-coverage-shaped entitlement (courses access, no expiry) — the FINAL student-entitlement derivation', () => {
    // Shape pushed by api/entitlement/user.ts's resolveClassCourseCoverage:
    // { access_type: 'courses', granted_courses: [...], expires_at: null }.
    const classCoverage = [{ accessType: 'courses' as const, grantedCourses: ['spa_for_eng'], expiresAt: null }];
    const resolved = { isActive: false, tier: 'free' as const, isPending: false };
    expect(canAccessSeed(PREMIUM_COURSE, resolved, BELT_MAX_SEEDS.black, classCoverage)).toBe(true);
    // A different course isn't covered by this class's grant.
    const otherCourse = { course_code: 'deu_for_eng', pricing_tier: 'premium' as const, is_community: false };
    expect(canAccessSeed(otherCourse, resolved, BELT_MAX_SEEDS.black, classCoverage)).toBe(false);
  });

  it('a lapsed class-coverage grant (absent from entitlements) falls back to ordinary free-tier preview, never a lockout', () => {
    const resolved = { isActive: false, tier: 'free' as const, isPending: false };
    const access = checkCourseAccess(PREMIUM_COURSE, resolved, []);
    expect(access.canAccess).toBe(false);
    expect(access.canPreview).toBe(true);
    expect(access.previewMaxSeed).toBe(PREMIUM_PREVIEW_MAX_SEED);
  });

  it('a free-tier class course is never affected by class-coverage state either way', () => {
    const freeCourse = { course_code: 'gle_for_eng', pricing_tier: 'free' as const, is_community: false };
    const resolved = { isActive: false, tier: 'free' as const, isPending: false };
    expect(canAccessSeed(freeCourse, resolved, 9999)).toBe(true);
    expect(canAccessSeed(freeCourse, resolved, 9999, [])).toBe(true);
  });
});
