'use client';

import { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { scheduleSurfaceRgb } from '@/lib/contrastOnBackground';
import { contrastTextOnBackground } from '@/lib/scheduleMetaContrast';

/** Theme-aware surface used to blend semi-transparent schedule block colors for contrast. */
export function useScheduleContrastSurface() {
  const { resolvedTheme } = useTheme();
  const surface = useMemo(() => scheduleSurfaceRgb(resolvedTheme), [resolvedTheme]);
  const contrastOn = useMemo(
    () => (backgroundColor: string | null | undefined) => contrastTextOnBackground(backgroundColor, surface),
    [surface]
  );
  return { surface, contrastOn };
}
