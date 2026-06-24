import { describe, it, expect } from 'vitest';
import { matchesMobileLayout } from './layoutProfile';

describe('matchesMobileLayout', () => {
  it('treats narrow portrait as mobile', () => {
    expect(matchesMobileLayout({ width: 390, height: 844, coarsePointer: true })).toBe(true);
  });

  it('keeps landscape phones mobile when width exceeds 768', () => {
    expect(matchesMobileLayout({ width: 844, height: 390, coarsePointer: true })).toBe(true);
    expect(matchesMobileLayout({ width: 932, height: 430, coarsePointer: true })).toBe(true);
  });

  it('treats desktop monitors as desktop', () => {
    expect(matchesMobileLayout({ width: 1920, height: 1080, coarsePointer: false })).toBe(false);
  });

  it('treats wide landscape without coarse pointer as desktop', () => {
    expect(matchesMobileLayout({ width: 1200, height: 800, coarsePointer: false })).toBe(false);
  });

  it('treats narrow desktop windows as mobile layout', () => {
    expect(matchesMobileLayout({ width: 700, height: 900, coarsePointer: false })).toBe(true);
  });
});
