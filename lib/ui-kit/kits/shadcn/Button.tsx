'use client';

import type { VariantProps } from 'class-variance-authority';

import { Button as ShadcnButton, buttonVariants } from '@/components/ui/button';
import type { UiButtonProps } from '@/lib/ui-kit/types';

type ShadcnVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;

function mapVariant(variant: UiButtonProps['variant'] | undefined): ShadcnVariant {
  switch (variant) {
    case 'primary':
      return 'default';
    case 'danger':
      return 'destructive';
    case 'secondary':
    default:
      return 'secondary';
  }
}

export function Button({ variant = 'secondary', className, children, type = 'button', ...rest }: UiButtonProps) {
  return (
    <ShadcnButton type={type} variant={mapVariant(variant)} className={className} {...rest}>
      {children}
    </ShadcnButton>
  );
}
