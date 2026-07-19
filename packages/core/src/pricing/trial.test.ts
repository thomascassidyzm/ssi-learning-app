import { describe, it, expect } from 'vitest';
import {
  isCommercialCourse,
  trialDaysForCourse,
  targetLangFromCourseCode,
  TRIAL_DAYS_COMMERCIAL,
  TRIAL_DAYS_HERITAGE,
} from './trial';

describe('trial duration by course type', () => {
  it('parses the target language out of a course code', () => {
    expect(targetLangFromCourseCode('spa_for_eng')).toBe('spa');
    expect(targetLangFromCourseCode('cym_s_for_eng')).toBe('cym');
    expect(targetLangFromCourseCode('ara_lb_for_eng')).toBe('ara');
    expect(targetLangFromCourseCode('')).toBe('');
    expect(targetLangFromCourseCode(null)).toBe('');
  });

  describe('commercial (Big-10 target) courses → 30-day trial', () => {
    const commercial = ['spa_for_eng', 'fra_for_eng', 'jpn_for_eng', 'eng_for_hin', 'zho_for_gle'];
    for (const code of commercial) {
      it(`${code} is commercial → ${TRIAL_DAYS_COMMERCIAL} days`, () => {
        expect(isCommercialCourse({ course_code: code })).toBe(true);
        expect(trialDaysForCourse({ course_code: code })).toBe(TRIAL_DAYS_COMMERCIAL);
      });
    }

    it('uses target_lang when supplied, overriding a missing course_code', () => {
      expect(trialDaysForCourse({ target_lang: 'kor' })).toBe(TRIAL_DAYS_COMMERCIAL);
    });
  });

  describe('heritage (non-Big-10 target) courses → 365-day trial', () => {
    // Welsh is priced premium but is HERITAGE — the whole point of the ruling.
    const heritage = ['cym_s_for_eng', 'cym_n_for_eng', 'gle_for_eng', 'cat_for_eng', 'eus_for_spa'];
    for (const code of heritage) {
      it(`${code} is heritage → ${TRIAL_DAYS_HERITAGE} days`, () => {
        expect(isCommercialCourse({ course_code: code })).toBe(false);
        expect(trialDaysForCourse({ course_code: code })).toBe(TRIAL_DAYS_HERITAGE);
      });
    }

    it('Welsh via target_lang is heritage despite premium pricing', () => {
      expect(trialDaysForCourse({ target_lang: 'cym', course_code: 'cym_s_for_eng' })).toBe(
        TRIAL_DAYS_HERITAGE,
      );
    });
  });
});
