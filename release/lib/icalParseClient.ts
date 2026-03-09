/**
 * Browser-side iCal parser: extract date and title from VEVENTs.
 * Used for View Feed modal (stream → parse → show dates/titles, newest to oldest).
 */
export interface ParsedIcalEvent {
  date: string;
  title: string;
}

export function parseIcalToDateTitles(raw: string): ParsedIcalEvent[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let normalized = trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized.charCodeAt(0) === 0xfeff) {
    normalized = normalized.slice(1);
  }

  const rawLines = normalized.split('\n');
  const unfolded: string[] = [];
  let current = '';
  for (const line of rawLines) {
    if (!current) {
      current = line;
    } else if (line.startsWith(' ') || line.startsWith('\t')) {
      current += line.slice(1);
    } else {
      unfolded.push(current);
      current = line;
    }
  }
  if (current) unfolded.push(current);

  const events: ParsedIcalEvent[] = [];
  let inEvent = false;
  let startDate: string | null = null;
  let summary: string | null = null;

  for (const line of unfolded) {
    if (line.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      startDate = null;
      summary = null;
      continue;
    }
    if (line.startsWith('END:VEVENT')) {
      if (inEvent && startDate) {
        events.push({
          date: startDate,
          title: summary && summary.length > 0 ? summary : '(no title)',
        });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    if (line.startsWith('DTSTART')) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        const val = line.slice(idx + 1).trim();
        if (/^\d{8}/.test(val)) {
          const y = val.slice(0, 4);
          const m = val.slice(4, 6);
          const d = val.slice(6, 8);
          startDate = `${y}-${m}-${d}`;
        }
      }
    } else if (line.startsWith('SUMMARY')) {
      const idx = line.indexOf(':');
      if (idx !== -1) {
        summary = line.slice(idx + 1).trim();
      }
    }
  }

  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events;
}
