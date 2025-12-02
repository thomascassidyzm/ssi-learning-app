import type { LearningConfig, PartialLearningConfig } from './types';
import { DEFAULT_CONFIG } from './defaults';

/**
 * ConfigResolver - Three-tier configuration hierarchy
 * System Defaults → Course/School Overrides → Learner Adaptive Overrides
 */
export class ConfigResolver {
  private systemDefaults: LearningConfig;
  private courseOverrides: PartialLearningConfig = {};
  private learnerOverrides: PartialLearningConfig = {};

  constructor(systemDefaults: LearningConfig = DEFAULT_CONFIG) {
    this.systemDefaults = systemDefaults;
  }

  /**
   * Set course or school level overrides
   */
  setCourseOverrides(overrides: PartialLearningConfig): void {
    this.courseOverrides = overrides;
  }

  /**
   * Set learner-specific adaptive overrides
   */
  setLearnerOverrides(overrides: PartialLearningConfig): void {
    this.learnerOverrides = overrides;
  }

  /**
   * Update a single learner parameter (for real-time adaptation)
   */
  updateLearnerParam<K extends keyof LearningConfig>(
    section: K,
    key: keyof LearningConfig[K],
    value: LearningConfig[K][keyof LearningConfig[K]]
  ): void {
    if (!this.learnerOverrides[section]) {
      this.learnerOverrides[section] = {};
    }
    (this.learnerOverrides[section] as Record<string, unknown>)[key as string] = value;
  }

  /**
   * Resolve the final configuration by merging all tiers
   * Learner > Course > System Defaults
   */
  resolve(): LearningConfig {
    return this.deepMerge(
      this.systemDefaults,
      this.courseOverrides,
      this.learnerOverrides
    );
  }

  /**
   * Get a specific config section
   */
  get<K extends keyof LearningConfig>(section: K): LearningConfig[K] {
    return this.resolve()[section];
  }

  /**
   * Get a specific parameter value
   */
  getParam<K extends keyof LearningConfig>(
    section: K,
    key: keyof LearningConfig[K]
  ): LearningConfig[K][keyof LearningConfig[K]] {
    return this.resolve()[section][key];
  }

  /**
   * Export current overrides for persistence
   */
  exportOverrides(): { course: PartialLearningConfig; learner: PartialLearningConfig } {
    return {
      course: this.courseOverrides,
      learner: this.learnerOverrides,
    };
  }

  /**
   * Import overrides from persistence
   */
  importOverrides(overrides: { course?: PartialLearningConfig; learner?: PartialLearningConfig }): void {
    if (overrides.course) {
      this.courseOverrides = overrides.course;
    }
    if (overrides.learner) {
      this.learnerOverrides = overrides.learner;
    }
  }

  /**
   * Reset learner overrides (start fresh)
   */
  resetLearnerOverrides(): void {
    this.learnerOverrides = {};
  }

  /**
   * Deep merge utility - later objects override earlier ones
   */
  private deepMerge(
    base: LearningConfig,
    ...overrides: PartialLearningConfig[]
  ): LearningConfig {
    const result = JSON.parse(JSON.stringify(base)) as LearningConfig;

    for (const override of overrides) {
      for (const key of Object.keys(override) as Array<keyof LearningConfig>) {
        const overrideValue = override[key];
        if (overrideValue !== undefined) {
          // Type-safe merge for each section
          const resultAny = result as unknown as Record<string, Record<string, unknown>>;
          const baseSection = resultAny[key] ?? {};
          resultAny[key] = { ...baseSection, ...overrideValue };
        }
      }
    }

    return result;
  }
}

/**
 * Factory function for creating a resolver with optional initial overrides
 */
export function createConfigResolver(
  courseOverrides?: PartialLearningConfig,
  learnerOverrides?: PartialLearningConfig
): ConfigResolver {
  const resolver = new ConfigResolver();
  if (courseOverrides) {
    resolver.setCourseOverrides(courseOverrides);
  }
  if (learnerOverrides) {
    resolver.setLearnerOverrides(learnerOverrides);
  }
  return resolver;
}
