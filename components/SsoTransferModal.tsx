'use client';

import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';

export type SsoTransferPendingInfo = {
  provider: string;
  email: string;
  other_username: string;
};

type Props = {
  pending: SsoTransferPendingInfo;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function providerLabel(provider: string): string {
  if (provider === 'google') return 'Google';
  if (provider === 'outlook') return 'Outlook';
  return provider;
}

export function SsoTransferModal({ pending, busy, onConfirm, onCancel }: Props) {
  const label = providerLabel(pending.provider);
  return (
    <Modal
      open
      onClose={busy ? () => {} : onCancel}
      title="Move sign-in provider?"
      aria-label="Confirm SSO transfer"
      actions={
        <>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? 'Moving…' : 'Move to this account'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        {label} ({pending.email}) is already linked to account <strong>{pending.other_username}</strong>.
      </p>
      <p style={{ marginBottom: 0 }}>
        Move it to your current account? It will be removed from {pending.other_username} and only this account
        will be able to sign in with {label}.
      </p>
    </Modal>
  );
}
