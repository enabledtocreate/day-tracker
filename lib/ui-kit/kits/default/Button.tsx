'use client';

import type { UiButtonProps } from '@/lib/ui-kit/types';

export function Button({ variant = 'secondary', className = '', children, ...rest }: UiButtonProps) {
  const v = variant === 'primary' ? 'button-primary' : variant === 'danger' ? 'button-danger' : '';
  return (
    <button type="button" className={`${v} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
