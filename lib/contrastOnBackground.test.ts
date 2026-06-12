import { describe, it, expect } from 'vitest';
import { blendRgbaOnSurface, contrastIconColorOnBackground, relativeLuminance } from './contrastOnBackground';

describe('contrastOnBackground', () => {
  it('picks dark icon when blended result is light', () => {
    expect(contrastIconColorOnBackground('rgba(220, 220, 220, 0.85)', { r: 248, g: 248, b: 250 })).toBe('#141414');
  });

  it('picks light icon when blended result is dark', () => {
    expect(contrastIconColorOnBackground('rgba(220, 220, 220, 0.45)', { r: 28, g: 30, b: 34 })).toBe('#f4f4f4');
    expect(contrastIconColorOnBackground('hsla(200, 50%, 25%, 0.9)', { r: 28, g: 30, b: 34 })).toBe('#f4f4f4');
  });

  it('blendRgbaOnSurface respects alpha', () => {
    const blended = blendRgbaOnSurface({ r: 255, g: 0, b: 0, a: 0.5 }, { r: 0, g: 0, b: 0 });
    expect(blended).toEqual({ r: 128, g: 0, b: 0 });
    expect(relativeLuminance(blended)).toBeLessThan(0.2);
  });
});
