/** Local calendar date YYYY-MM-DD (avoid `toISOString()` day shifts in non-UTC time zones). */
export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function todayLocalYmd(): string {
  return formatLocalYmd(new Date());
}

/** Sunday local date for the calendar week (Sun–Sat) that contains dateStr. */
export function sundayOfWeekContaining(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return formatLocalYmd(d);
}

/** Week columns: anchor is Sunday. 7-day = Sun–Sat; weekday = Mon–Fri of that week. */
export function buildWeekDates(anchorSunday: string, scope: '7-day' | 'weekday'): string[] {
  if (scope === '7-day') {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(anchorSunday + 'T12:00:00');
      d.setDate(d.getDate() + i);
      return formatLocalYmd(d);
    });
  }
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(anchorSunday + 'T12:00:00');
    d.setDate(d.getDate() + 1 + i);
    return formatLocalYmd(d);
  });
}

export function getMonthRange(date: string): { from: string; to: string } {
  const d = new Date(date + 'T12:00:00');
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  return { from: formatLocalYmd(first), to: formatLocalYmd(last) };
}
