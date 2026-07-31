import { describe, it, expect } from 'vitest';
import {
  computeLegoCentrality,
  tokenizeTarget,
  type CentralityLego,
  type CentralityPhrase,
} from './centrality';

const lego = (legoId: string, ordinal: number, target: string): CentralityLego => ({
  legoId,
  ordinal,
  target,
});
const phrase = (ownerOrdinal: number, target: string): CentralityPhrase => ({
  ownerOrdinal,
  target,
});

describe('tokenizeTarget', () => {
  it('lowercases and splits on non-letter/digit, unicode-aware', () => {
    expect(tokenizeTarget('Quiero aprender, ¿sabes?')).toEqual(['quiero', 'aprender', 'sabes']);
  });

  it('splits elision/contraction on the apostrophe', () => {
    expect(tokenizeTarget("qu'il")).toEqual(['qu', 'il']);
  });

  it('keeps diacritics distinct', () => {
    expect(tokenizeTarget('está')).toEqual(['está']);
  });
});

describe('computeLegoCentrality — forward reuse', () => {
  it('counts only SUBSEQUENT phrases containing the LEGO', () => {
    const legos = [lego('S0001L01', 1, 'quiero'), lego('S0002L01', 2, 'hablar')];
    const phrases = [
      phrase(1, 'quiero aprender'), // own phrase — NOT subsequent, never counts
      phrase(2, 'quiero hablar contigo'), // later phrase containing "quiero" → counts for L1
      phrase(2, 'necesito hablar'), // no "quiero" → not for L1; own for L2 → not for L2
    ];
    const result = computeLegoCentrality(legos, phrases);
    expect(result.get('S0001L01')!.forwardReuse).toBe(1);
    // "hablar" appears only in its own phrases, nothing subsequent.
    expect(result.get('S0002L01')!.forwardReuse).toBe(0);
  });

  it('a phrase of an EARLIER lego containing a later lego never counts for the later lego', () => {
    const legos = [lego('S0001L01', 1, 'quiero'), lego('S0005L01', 5, 'mañana')];
    // An ordinal-3 phrase mentions "mañana" — behind lego 5's introduction, blocks nothing.
    const phrases = [phrase(3, 'hasta mañana')];
    const result = computeLegoCentrality(legos, phrases);
    expect(result.get('S0005L01')!.forwardReuse).toBe(0);
  });

  it('counts later M-LEGO compositions that tile the LEGO', () => {
    const legos = [
      lego('S0001L01', 1, 'hablar'),
      // Later molecular LEGO whose target contains "hablar" — a composition edge.
      lego('S0003L01', 3, 'quiero hablar'),
    ];
    const result = computeLegoCentrality(legos, []);
    expect(result.get('S0001L01')!.forwardReuse).toBe(1);
    expect(result.get('S0003L01')!.forwardReuse).toBe(0);
  });

  it('matches whole tokens only — "en" inside "bien" is no match; elision "qu\'il" contains "il"', () => {
    const legos = [lego('EN', 1, 'en'), lego('IL', 2, 'il')];
    const phrases = [
      phrase(3, 'muy bien hecho'), // "en" inside "bien" must NOT count
      phrase(3, "je pense qu'il vient"), // elision — "il" must count
    ];
    const result = computeLegoCentrality(legos, phrases);
    expect(result.get('EN')!.forwardReuse).toBe(0);
    expect(result.get('IL')!.forwardReuse).toBe(1);
  });

  it('multi-token LEGOs require the contiguous sequence, not scattered words', () => {
    const legos = [lego('M1', 1, 'antes de que')];
    const phrases = [
      phrase(2, 'antes de que empieces'), // contiguous → counts
      phrase(2, 'antes de todo lo que dijiste'), // scattered → no
    ];
    const result = computeLegoCentrality(legos, phrases);
    expect(result.get('M1')!.forwardReuse).toBe(1);
  });

  it('percentiles rank hubs to 1 and leaves to 0, ties sharing', () => {
    const legos = [
      lego('HUB', 1, 'quiero'),
      lego('LEAF1', 2, 'zanahoria'),
      lego('LEAF2', 3, 'paraguas'),
    ];
    const phrases = [
      phrase(4, 'quiero uno'),
      phrase(5, 'quiero dos'),
      phrase(6, 'quiero tres'),
    ];
    const result = computeLegoCentrality(legos, phrases);
    expect(result.get('HUB')!.percentile).toBe(1);
    expect(result.get('LEAF1')!.percentile).toBe(0);
    expect(result.get('LEAF2')!.percentile).toBe(0); // tie shares the lower rank
  });

  it('handles empty inputs without blowing up', () => {
    expect(computeLegoCentrality([], []).size).toBe(0);
    const solo = computeLegoCentrality([lego('A', 1, 'hola')], []);
    expect(solo.get('A')!.forwardReuse).toBe(0);
    expect(solo.get('A')!.percentile).toBe(1); // single lego: rank is trivially top
  });
});
