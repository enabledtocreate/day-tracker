'use client';

import { useEffect, useRef } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  'aria-label'?: string;
};

export function Modal({ open, onClose, title, children, actions, 'aria-label': ariaLabel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

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
      className="link-modal admin-logs-modal modal-with-close"
      aria-label={ariaLabel ?? title}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="modal-header-row">
        <h3>{title}</h3>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      {children}
      {actions != null && <div className="modal-actions">{actions}</div>}
    </dialog>
  );
}
