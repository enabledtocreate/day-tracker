/**
 * Build YYYY-MM-DD strings for a month grid: leading empty strings pad to Sunday, then each day of month.
 */
export function buildCalendarDays(monthAnchorYmd: string): string[] {
  const d = new Date(monthAnchorYmd + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const startPad = first.getDay();
  const days: string[] = [];
  for (let i = 0; i < startPad; i++) days.push('');
  for (let day = 1; day <= last.getDate(); day++) {
    days.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return days;
}
