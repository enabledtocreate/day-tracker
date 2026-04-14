'use client';

import * as Dialog from '@radix-ui/react-dialog';
import type { UiModalProps } from '@/lib/ui-kit/types';

/**
 * Radix-based modal (same family as Shadcn `Dialog`). Styled with existing app CSS variables/classes.
 * Swap to `@/components/ui/dialog` from Shadcn after running the CLI if you prefer generated markup.
 */
export function Modal({ open, onClose, title, children, actions, 'aria-label': ariaLabel, className: classNameProp }: UiModalProps) {
  if (!open) return null;

  const contentClass =
    'link-modal admin-logs-modal modal-with-close ui-kit-radix-dialog-content' + (classNameProp ? ` ${classNameProp}` : '');

  return (
    <Dialog.Root modal open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-kit-radix-dialog-overlay" />
        <Dialog.Content className={contentClass} aria-label={ariaLabel ?? title}>
          <div className="modal-header-row">
            <Dialog.Title asChild>
              <h3>{title}</h3>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="modal-close-btn" aria-label="Close">
                ×
              </button>
            </Dialog.Close>
          </div>
          {children}
          {actions != null && <div className="modal-actions">{actions}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
