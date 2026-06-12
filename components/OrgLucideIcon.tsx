'use client';

import { Square } from 'lucide-react';
import { DynamicIcon } from 'lucide-react/dynamic';
import dynamicIconImports from 'lucide-react/dynamicIconImports';
import type { IconName } from 'lucide-react/dynamic';
import { normalizeStoredOrgIcon } from '@/lib/orgLucideIconNames';

type Props = {
  name: string | null | undefined;
  /** Pixel size (passed as width + height to Lucide). */
  size?: number;
  className?: string;
  'aria-hidden'?: boolean;
};

function isDynamicIconName(key: string): key is IconName {
  return Object.prototype.hasOwnProperty.call(dynamicIconImports, key);
}

export function OrgLucideIcon({ name, size = 16, className, 'aria-hidden': ariaHidden = true }: Props) {
  const key = normalizeStoredOrgIcon(name);
  if (!key || !isDynamicIconName(key)) {
    return null;
  }
  return (
    <DynamicIcon
      name={key}
      width={size}
      height={size}
      className={className}
      aria-hidden={ariaHidden}
      strokeWidth={2}
      fallback={() => (
        <Square width={size} height={size} className={className} aria-hidden={ariaHidden} strokeWidth={2} />
      )}
    />
  );
}
