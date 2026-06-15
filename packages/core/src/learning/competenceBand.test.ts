import { describe, it, expect } from 'vitest';
import {
  competenceBand,
  ENTRY_CONVERSATIONAL_HOURS,
  B1_CONVERSATIONAL_HOURS,
} from './competenceBand';

const H = 60; // minutes per hour

describe('competenceBand', () => {
  it('a brand-new learner is warming up, with zero hours', () => {
    const b = competenceBand(0);
    expect(b.band).toBe('warming_up');
    expect(b.hoursOnTask).toBe(0);
    expect(b.progressToNext).toBe(0);
    expect(b.basis).toBe('time-on-task');
    expect(b.confidence).toBe('flat-anchor');
  });

  it('just below the 30h anchor is still warming up', () => {
    const b = competenceBand((ENTRY_CONVERSATIONAL_HOURS - 0.1) * H);
    expect(b.band).toBe('warming_up');
    expect(b.progressToNext).toBeCloseTo((ENTRY_CONVERSATIONAL_HOURS - 0.1) / ENTRY_CONVERSATIONAL_HOURS, 6);
  });

  it('crosses to entry-conversational exactly at the 30h anchor', () => {
    const b = competenceBand(ENTRY_CONVERSATIONAL_HOURS * H);
    expect(b.band).toBe('entry_conversational');
    expect(b.hoursOnTask).toBe(30);
    expect(b.progressToNext).toBeCloseTo(0, 6);
  });

  it('reports half-way progress between the 30h and 100h anchors', () => {
    const midHours = (ENTRY_CONVERSATIONAL_HOURS + B1_CONVERSATIONAL_HOURS) / 2; // 65h
    const b = competenceBand(midHours * H);
    expect(b.band).toBe('entry_conversational');
    expect(b.progressToNext).toBeCloseTo(0.5, 6);
  });

  it('crosses to ~B1 exactly at the 100h anchor', () => {
    const b = competenceBand(B1_CONVERSATIONAL_HOURS * H);
    expect(b.band).toBe('b1_conversational');
    expect(b.progressToNext).toBe(1);
  });

  it('stays b1_conversational between 100h and 200h', () => {
    expect(competenceBand(150 * H).band).toBe('b1_conversational');
  });

  it('reads beyond_anchor only well past the final anchor (>= 2x)', () => {
    expect(competenceBand(2 * B1_CONVERSATIONAL_HOURS * H).band).toBe('beyond_anchor');
    expect(competenceBand(500 * H).band).toBe('beyond_anchor');
  });

  it('is honest about basis and confidence at every band (never asserts a hard level)', () => {
    for (const minutes of [0, 30 * H, 100 * H, 400 * H]) {
      const b = competenceBand(minutes);
      expect(b.basis).toBe('time-on-task');
      expect(b.confidence).toBe('flat-anchor');
    }
  });

  it('treats non-finite or negative input as zero practice rather than throwing', () => {
    for (const bad of [NaN, Infinity, -Infinity, -120]) {
      const b = competenceBand(bad);
      expect(b.band).toBe('warming_up');
      expect(b.hoursOnTask).toBe(0);
    }
  });

  it('is monotonic in the band ordering as minutes increase', () => {
    const order: Record<string, number> = {
      warming_up: 0,
      entry_conversational: 1,
      b1_conversational: 2,
      beyond_anchor: 3,
    };
    let prev = -1;
    for (let h = 0; h <= 220; h += 5) {
      const rank = order[competenceBand(h * H).band];
      expect(rank).toBeGreaterThanOrEqual(prev);
      prev = rank;
    }
  });
});
