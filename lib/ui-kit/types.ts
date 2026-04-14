import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type UiButtonVariant = 'primary' | 'secondary' | 'danger';

export type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: UiButtonVariant;
  children: ReactNode;
};

export type UiModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  'aria-label'?: string;
  /** Semantic app hook (e.g. `dt-modal-foo`); merged with base modal classes */
  className?: string;
};

/** Supported kit ids — set `NEXT_PUBLIC_UI_KIT` to switch implementations at build time */
export type UiKitId = 'default' | 'shadcn';
