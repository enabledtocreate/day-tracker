import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal backdrop click semantics', () => {
  it('does not close when mousedown is inside and click is on backdrop', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test Modal">
        <button type="button">Inner</button>
      </Modal>
    );

    const dialog = document.querySelector('dialog[aria-label="Test Modal"]') as HTMLDialogElement;
    const innerBtn = dialog.querySelector('button:not(.modal-close-btn)') as HTMLButtonElement;

    fireEvent.mouseDown(innerBtn);
    fireEvent.click(dialog); // click backdrop

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when mousedown is on backdrop and click is on backdrop', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test Modal">
        <button type="button">Inner</button>
      </Modal>
    );

    const dialog = document.querySelector('dialog[aria-label="Test Modal"]') as HTMLDialogElement;

    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog); // click backdrop

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when mousedown is on backdrop but click is inside', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test Modal">
        <button type="button">Inner</button>
      </Modal>
    );

    const dialog = document.querySelector('dialog[aria-label="Test Modal"]') as HTMLDialogElement;
    const innerBtn = dialog.querySelector('button:not(.modal-close-btn)') as HTMLButtonElement;

    fireEvent.mouseDown(dialog);
    fireEvent.click(innerBtn); // click inside content

    expect(onClose).not.toHaveBeenCalled();
  });
});

