'use client';

/**
 * MobilePickerModal — single shared picker dialog used by every mobile
 * `<select>` replacement. See `.apm/_WORKSPACE/TODO-mobile.md §0.3 / §0.8` for
 * the decision to centralise on one modal instead of bespoke per-control modals.
 *
 * Single-select mode: tap an option → onChange + onClose immediately.
 * Multi-select mode: tap toggles each option; user confirms with OK.
 * Search input appears when `options.length >= searchThreshold` (default 8).
 *
 * The modal registers `useModalGestureSuppression` so the gesture coordinator
 * suppresses Tap / Double Tap / Long Press / Swipe while it is open.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useModalGestureSuppression } from '@/lib/mobileMode';

export type MobilePickerOption<T> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

type CommonProps<T> = {
  open: boolean;
  onClose: () => void;
  title: string;
  options: MobilePickerOption<T>[];
  searchThreshold?: number;
  className?: string;
  /** Optional helper text under the title. */
  helperText?: string;
  /** Custom label for the primary action (multi-select). Default "OK". */
  okLabel?: string;
};

export type SingleSelectProps<T> = CommonProps<T> & {
  multiple?: false;
  value: T | null;
  onChange: (next: T) => void;
};

export type MultiSelectProps<T> = CommonProps<T> & {
  multiple: true;
  value: T[];
  onChange: (next: T[]) => void;
  /** Optional minimum required selection in multi mode. Default 0. */
  minSelection?: number;
};

export type MobilePickerModalProps<T> = SingleSelectProps<T> | MultiSelectProps<T>;

function isMultiProps<T>(p: MobilePickerModalProps<T>): p is MultiSelectProps<T> {
  return p.multiple === true;
}

function optionMatchesSearch(opt: MobilePickerOption<unknown>, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (opt.label.toLowerCase().includes(q)) return true;
  if (opt.description && opt.description.toLowerCase().includes(q)) return true;
  return false;
}

export function MobilePickerModal<T extends string | number>(
  props: MobilePickerModalProps<T>
) {
  const { open, onClose, title, options, searchThreshold = 8, className, helperText, okLabel } = props;

  useModalGestureSuppression(open);

  const [search, setSearch] = useState('');
  // Local pending selection only for multi mode (so user can cancel)
  const [pending, setPending] = useState<T[]>(isMultiProps(props) ? props.value : []);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    if (isMultiProps(props)) {
      setPending(props.value);
    }
    // We only want this to re-run when the modal is opened, not on every value change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(
    () => options.filter((opt) => optionMatchesSearch(opt, search)),
    [options, search]
  );

  const showSearch = options.length >= searchThreshold;

  const handleSelectSingle = (value: T) => {
    if (isMultiProps(props)) return;
    props.onChange(value);
    onClose();
  };

  const togglePendingMulti = (value: T) => {
    setPending((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleConfirm = () => {
    if (!isMultiProps(props)) return;
    const min = props.minSelection ?? 0;
    if (pending.length < min) return;
    props.onChange(pending);
    onClose();
  };

  const actions = isMultiProps(props) ? (
    <>
      <Button type="button" onClick={onClose}>
        Cancel
      </Button>
      <Button type="button" onClick={handleConfirm}>
        {okLabel ?? 'OK'}
      </Button>
    </>
  ) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className={'mobile-picker-modal' + (className ? ` ${className}` : '')}
      actions={actions ?? undefined}
    >
      {helperText && (
        <p className="mobile-picker-helper" style={{ margin: '0 0 0.6rem', color: 'var(--text-muted)' }}>
          {helperText}
        </p>
      )}
      {showSearch && (
        <div className="mobile-picker-search" style={{ marginBottom: '0.6rem' }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            aria-label={`Search ${title}`}
            style={{
              width: '100%',
              padding: '0.45rem 0.55rem',
              fontSize: '0.95rem',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          />
        </div>
      )}
      <ul
        className="mobile-picker-list"
        role={isMultiProps(props) ? 'listbox' : 'radiogroup'}
        aria-label={title}
        aria-multiselectable={isMultiProps(props) ? true : undefined}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
      >
        {filtered.length === 0 && (
          <li
            className="mobile-picker-empty"
            style={{ padding: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}
          >
            No matches.
          </li>
        )}
        {filtered.map((opt) => {
          const isSelected = isMultiProps(props)
            ? pending.includes(opt.value)
            : props.value === opt.value;
          const disabled = !!opt.disabled;
          return (
            <li
              key={String(opt.value)}
              role={isMultiProps(props) ? 'option' : 'radio'}
              aria-selected={isMultiProps(props) ? isSelected : undefined}
              aria-checked={!isMultiProps(props) ? isSelected : undefined}
              aria-disabled={disabled || undefined}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  isMultiProps(props) ? togglePendingMulti(opt.value) : handleSelectSingle(opt.value)
                }
                className={
                  'mobile-picker-option' +
                  (isSelected ? ' mobile-picker-option-selected' : '') +
                  (disabled ? ' mobile-picker-option-disabled' : '')
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.7rem 0.6rem',
                  background: isSelected ? 'var(--accent-bg)' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border-subtle)',
                  color: 'var(--text)',
                  fontSize: '0.95rem',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.45 : 1,
                  minHeight: 44,
                }}
              >
                <span
                  aria-hidden
                  className="mobile-picker-option-indicator"
                  style={{
                    flex: '0 0 auto',
                    width: 20,
                    height: 20,
                    borderRadius: isMultiProps(props) ? 4 : 10,
                    border: '1.5px solid var(--text-muted)',
                    background: isSelected ? 'var(--accent)' : 'transparent',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 13,
                    lineHeight: 1,
                  }}
                >
                  {isSelected ? '✓' : ''}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {opt.description}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
