import { describe, it, expect } from 'vitest';
import {
  scheduleBlockLabelStyle,
  scheduleCategoryMetaStyle,
  scheduleTagPillStyle,
} from './scheduleMetaContrast';

const darkSurface = { r: 28, g: 30, b: 34 };

describe('scheduleMetaContrast', () => {
  it('scheduleTagPillStyle uses contrast on tag fill', () => {
    const lightTag = scheduleTagPillStyle('hsl(200, 80%, 75%)', darkSurface);
    expect(lightTag.color).toBe('#141414');
    const darkTag = scheduleTagPillStyle('hsl(220, 60%, 22%)', darkSurface);
    expect(darkTag.color).toBe('#f4f4f4');
  });

  it('scheduleCategoryMetaStyle contrasts against slot tint', () => {
    const style = scheduleCategoryMetaStyle('rgba(220, 220, 220, 0.45)', darkSurface);
    expect(style.color).toBe('#f4f4f4');
  });

  it('scheduleBlockLabelStyle contrasts against strip background', () => {
    const style = scheduleBlockLabelStyle('#6e84a3', darkSurface);
    expect(style.color).toMatch(/^#[1414f4]{6}$/);
  });
});
