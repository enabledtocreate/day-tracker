'use client';

type Props = {
  slotDurationMinutes: number;
  minutes: number;
  onMinutesChange: (minutes: number) => void;
  disabled?: boolean;
  helpText?: string;
};

/** Default duration picker shown in minutes; stored as schedule increment intervals. */
export function DefaultDurationMinutesField({
  slotDurationMinutes,
  minutes,
  onMinutesChange,
  disabled,
  helpText,
}: Props) {
  const step = Math.max(1, slotDurationMinutes);
  return (
    <>
      <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        Default duration ({step} min per step)
        <input
          type="number"
          min={step}
          step={step}
          disabled={disabled}
          value={minutes}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10);
            if (!Number.isFinite(raw)) return;
            onMinutesChange(Math.max(step, Math.round(raw / step) * step));
          }}
          style={{ padding: '0.35rem', maxWidth: '6rem' }}
        />
      </label>
      {helpText && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{helpText}</p>
      )}
    </>
  );
}
