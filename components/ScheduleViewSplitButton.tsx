'use client';

import { Clock } from 'lucide-react';

type Props = {
  label: string;
  active: boolean;
  onSelectView: () => void;
  onOpenSummary: () => void;
  summaryTitle: string;
};

/** Segmented control: summary icon (left) + view switch (right). */
export function ScheduleViewSplitButton({
  label,
  active,
  onSelectView,
  onOpenSummary,
  summaryTitle,
}: Props) {
  return (
    <div className={'schedule-view-split' + (active ? ' schedule-view-split--active' : '')}>
      <button
        type="button"
        className="schedule-view-split-btn schedule-view-split-btn--summary"
        title={summaryTitle}
        aria-label={summaryTitle}
        onClick={(e) => {
          e.stopPropagation();
          onOpenSummary();
        }}
      >
        <Clock size={15} aria-hidden strokeWidth={2} />
      </button>
      <button
        type="button"
        className="schedule-view-split-btn schedule-view-split-btn--view"
        aria-pressed={active ? 'true' : 'false'}
        onClick={onSelectView}
      >
        {label}
      </button>
    </div>
  );
}
