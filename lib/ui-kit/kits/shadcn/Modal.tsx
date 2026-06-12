'use client';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import type { UiModalProps } from '@/lib/ui-kit/types';
import { cn } from '@/lib/utils';

export function Modal({ open, onClose, title, children, actions, 'aria-label': ariaLabel, className: classNameProp, nested }: UiModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} modal>
      <DialogContent
        nested={nested}
        showCloseButton={false}
        aria-label={ariaLabel ?? title}
        className={cn(
          'link-modal admin-logs-modal modal-with-close max-h-[90vh] w-[min(90vw,560px)] max-w-[min(90vw,560px)] overflow-auto gap-0 p-4 text-left',
          classNameProp
        )}
      >
        <div className="modal-header-row">
          <DialogTitle className="m-0 flex-1 text-base font-medium leading-none">{title}</DialogTitle>
          <DialogClose className="modal-close-btn h-8 w-8 shrink-0 rounded border-0 bg-transparent p-0 text-[1.5rem] leading-none" aria-label="Close">
            ×
          </DialogClose>
        </div>
        {children}
        {actions != null && <div className="modal-actions">{actions}</div>}
      </DialogContent>
    </Dialog>
  );
}
