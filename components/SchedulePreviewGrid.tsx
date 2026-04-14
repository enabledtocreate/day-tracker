'use client';

import type { ScheduledSlot, TimeSettings } from '@/lib/api';
import type { PreviewProposedSlot } from '@/lib/aiApply';

const ROW_HEIGHT = 32;

function timeToMinutes(time: string | null | undefined): number {
  if (time == null || time === '') return 0;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatLabel(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + period;
}

function slotDurationMinutes(settings: TimeSettings): number {
  return settings.increment_unit === 'hr' ? settings.increment_value * 60 : settings.increment_value;
}

function slotHasTime(slot: ScheduledSlot): boolean {
  return !!(slot.start_time && slot.end_time);
}

type Props = {
  settings: TimeSettings;
  dates: string[];
  baselineByDate: Record<string, ScheduledSlot[]>;
  proposedSlots: PreviewProposedSlot[];
};

export function SchedulePreviewGrid({ settings, dates, baselineByDate, proposedSlots }: Props) {
  const viewStartMinutes = settings.start_hour * 60;
  const viewEndMinutes = settings.end_hour * 60;
  const step = Math.max(1, slotDurationMinutes(settings));
  const slotCount = Math.max(1, Math.ceil((viewEndMinutes - viewStartMinutes) / step));
  const totalHeight = slotCount * ROW_HEIGHT;
  const slotLabels: string[] = [];
  for (let i = 0; i < slotCount; i++) {
    const min = viewStartMinutes + i * step;
    slotLabels.push(min % 60 === 0 ? formatLabel(min) : '');
  }

  const proposedByDate = (date: string) => proposedSlots.filter((p) => p.date === date);

  return (
    <div className="schedule-preview-grid" role="region" aria-label="Schedule preview">
      {dates.map((date) => (
        <div key={date} className="schedule-preview-day">
          <div className="schedule-preview-day-header">{date}</div>
          <div className="time-view schedule-preview-time-view">
            <div className="time-view-container" style={{ height: totalHeight + 'px' }}>
              <div className="time-view-labels">
                {slotLabels.map((label, i) => (
                  <div key={i} className="time-view-label-row" style={{ height: ROW_HEIGHT + 'px' }}>
                    {label}
                  </div>
                ))}
              </div>
              <div className="time-view-blocks schedule-preview-blocks" style={{ height: totalHeight + 'px' }}>
                {slotLabels.map((_, i) => {
                  const min = viewStartMinutes + i * step;
                  const isHour = min % 60 === 0;
                  return (
                    <div
                      key={i}
                      className={isHour ? 'time-grid-line hour' : 'time-grid-line increment'}
                      style={{ top: i * ROW_HEIGHT + 'px' }}
                    />
                  );
                })}
                {(baselineByDate[date] ?? [])
                  .filter((s) => !s.completed && slotHasTime(s))
                  .map((s) => {
                    const sm = timeToMinutes(s.start_time);
                    const em = timeToMinutes(s.end_time);
                    const top = ((sm - viewStartMinutes) / step) * ROW_HEIGHT;
                    const h = Math.max(ROW_HEIGHT * 0.5, ((em - sm) / step) * ROW_HEIGHT);
                    return (
                      <div
                        key={`b-${s.id}`}
                        className="time-block schedule-preview-baseline"
                        style={{
                          top: top + 'px',
                          height: h + 'px',
                          left: '2%',
                          width: '96%',
                          pointerEvents: 'none',
                          opacity: 0.55,
                        }}
                      >
                        <div className="time-block-title-wrap">
                          <div className="time-block-title">{s.title ?? 'Task'}</div>
                        </div>
                      </div>
                    );
                  })}
                {proposedByDate(date).map((p) => {
                  const sm = timeToMinutes(p.start);
                  const em = timeToMinutes(p.end);
                  const top = ((sm - viewStartMinutes) / step) * ROW_HEIGHT;
                  const h = Math.max(ROW_HEIGHT * 0.5, ((em - sm) / step) * ROW_HEIGHT);
                  return (
                    <div
                      key={p.key}
                      className="time-block time-block-ghost schedule-preview-proposed"
                      style={{
                        top: top + 'px',
                        height: h + 'px',
                        left: '2%',
                        width: '96%',
                        pointerEvents: 'none',
                      }}
                    >
                      <div className="time-block-title-wrap">
                        <div className="time-block-title">{p.title}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
