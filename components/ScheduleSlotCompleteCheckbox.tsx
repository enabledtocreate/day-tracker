'use client';

import { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { scheduleSurfaceRgb } from '@/lib/contrastOnBackground';
import { contrastTextOnBackground } from '@/lib/scheduleMetaContrast';

type Props = {
  completed: boolean;
  disabled?: boolean;
  /** Hide for recurring occurrence on a future day (same rule as legacy check button). */
  hidden?: boolean;
  /** Block/category background used to pick a contrasting ☐/☑ color. */
  backgroundColor?: string | null;
  onToggle: () => void;
};

/** Leading schedule control: empty ☐ → checked ☑ (replaces drag-to-list handle). */
export function ScheduleSlotCompleteCheckbox({
  completed,
  disabled,
  hidden,
  backgroundColor,
  onToggle,
}: Props) {
  const { resolvedTheme } = useTheme();
  const iconColor = useMemo(
    () => contrastTextOnBackground(backgroundColor, scheduleSurfaceRgb(resolvedTheme)),
    [backgroundColor, resolvedTheme]
  );

  if (hidden) return null;
  return (
    <button
      type="button"
      className={'time-block-check time-block-complete-checkbox' + (completed ? ' is-checked' : '')}
      title={completed ? 'Mark incomplete' : 'Mark complete'}
      aria-label={completed ? 'Mark incomplete' : 'Mark complete'}
      aria-pressed={completed}
      disabled={disabled}
      style={{ color: iconColor, background: 'transparent' }}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onToggle();
      }}
    >
      {completed ? '☑' : '☐'}
    </button>
  );
}
