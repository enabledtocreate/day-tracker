'use client';

/**
 * Drop-in replacement for `<select>` that on mobile opens a `MobilePickerModal`
 * instead of the OS dropdown (per `.apm/_WORKSPACE/TODO-mobile.md §0.3`).
 *
 * On desktop (or when `forceMobile === false`) renders a native `<select>` so
 * keyboard / a11y behaviour is unchanged.
 *
 * Usage:
 *   <MobileAwareSelect
 *     value={blockTypeId}
 *     onChange={setBlockTypeId}
 *     options={[{ value: '', label: 'Block type' }, ...blocks.map(b => ({ value: b.id, label: b.name }))]}
 *     title="Block type"
 *   />
 *
 * For sites that need fancy renderers (icons / colours), open the modal manually
 * with `MobilePickerModal` instead.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { MOBILE_LAYOUT_MEDIA_QUERY } from '@/lib/layoutProfile';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { MobilePickerModal, type MobilePickerOption } from '@/components/mobile/MobilePickerModal';

export type MobileAwareSelectProps<T extends string | number> = {
  value: T;
  onChange: (next: T) => void;
  options: MobilePickerOption<T>[];
  /** Title for the mobile picker modal (and `aria-label` for the trigger). */
  title?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Force mobile layout even on desktop (useful for tests). */
  forceMobile?: boolean;
  /** Show a search field in the picker when option count is ≥ this. Default 8. */
  searchThreshold?: number;
  /** Custom render for the displayed value on the trigger button. */
  renderTriggerLabel?: (selected: MobilePickerOption<T> | null) => React.ReactNode;
};

const MOBILE_QUERY = MOBILE_LAYOUT_MEDIA_QUERY;

export function MobileAwareSelect<T extends string | number>(props: MobileAwareSelectProps<T>) {
  const {
    value,
    onChange,
    options,
    title,
    className,
    style,
    disabled,
    placeholder,
    ariaLabel,
    forceMobile,
    searchThreshold,
    renderTriggerLabel,
  } = props;

  const detectedMobile = useMediaQuery(MOBILE_QUERY);
  const isMobile = forceMobile ?? detectedMobile;

  const [open, setOpen] = useState(false);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  if (!isMobile) {
    return (
      <select
        className={className}
        style={style}
        disabled={disabled}
        value={String(value)}
        aria-label={ariaLabel ?? title}
        onChange={(e) => {
          const raw = e.target.value;
          const matched = options.find((o) => String(o.value) === raw);
          if (matched) onChange(matched.value);
        }}
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  const triggerLabel = renderTriggerLabel
    ? renderTriggerLabel(selectedOption)
    : selectedOption?.label ?? placeholder ?? title ?? 'Select…';

  return (
    <>
      <button
        type="button"
        className={'mobile-aware-select-trigger' + (className ? ` ${className}` : '')}
        style={{
          textAlign: 'left',
          padding: '0.4rem 0.55rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 4,
          minHeight: 36,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          minWidth: 0,
          ...style,
        }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={ariaLabel ?? title}
        onClick={() => setOpen(true)}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {triggerLabel}
        </span>
        <span aria-hidden style={{ color: 'var(--text-muted)' }}>
          ▾
        </span>
      </button>
      <MobilePickerModal<T>
        open={open}
        onClose={() => setOpen(false)}
        title={title ?? ariaLabel ?? 'Select'}
        options={options}
        value={value}
        onChange={(next) => onChange(next)}
        searchThreshold={searchThreshold}
      />
    </>
  );
}
