'use client';

import { useEffect, useRef } from 'react';
import type { UiModalProps } from '@/lib/ui-kit/types';

export function Modal({ open, onClose, title, children, actions, 'aria-label': ariaLabel, className: classNameProp }: UiModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const mouseDownOnBackdropRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onCloseEvent = () => onClose();
    dialog.addEventListener('close', onCloseEvent);
    return () => dialog.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className={'link-modal admin-logs-modal modal-with-close' + (classNameProp ? ` ${classNameProp}` : '')}
      aria-label={ariaLabel ?? title}
      onMouseDown={(e) => {
        mouseDownOnBackdropRef.current = e.target === ref.current;
      }}
      onClick={(e) => {
        if (e.target === ref.current && mouseDownOnBackdropRef.current) {
          onClose();
        }
      }}
    >
      <div className="modal-header-row">
        <h3>{title}</h3>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {children}
      {actions != null && <div className="modal-actions">{actions}</div>}
    </dialog>
  );
}
