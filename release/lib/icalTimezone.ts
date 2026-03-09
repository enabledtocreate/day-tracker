/**
 * Convert iCal event start/end (ISO, often UTC) to user's timezone for display and grouping.
 * Use when timezone is set or fall back to browser timezone.
 */

export interface IcalEventLocal {
  localStartDate: string;
  localEndDate: string;
  localStartTime: string;
  localEndTime: string;
  localStartMinutes: number;
  localEndMinutes: number;
}

/**
 * Parse an ISO date-time string (e.g. 2025-06-15T17:00:00Z or 2025-06-15) and return
 * the local date, time, and minutes-from-midnight in the given timezone.
 * If timezone is empty, uses the browser's timezone.
 */
export function icalEventToLocal(
  isoStart: string,
  isoEnd: string,
  allDay: boolean,
  timezone?: string
): IcalEventLocal {
  const tz = timezone && timezone.trim() ? timezone.trim() : undefined;

  if (allDay || isoStart.length <= 10) {
    const dateOnly = isoStart.slice(0, 10);
    return {
      localStartDate: dateOnly,
      localEndDate: isoEnd.length > 10 ? isoEnd.slice(0, 10) : dateOnly,
      localStartTime: '00:00',
      localEndTime: '23:59',
      localStartMinutes: 0,
      localEndMinutes: 24 * 60 - 1,
    };
  }

  const dStart = new Date(isoStart);
  const dEnd = new Date(isoEnd);
  if (Number.isNaN(dStart.getTime())) {
    return {
      localStartDate: isoStart.slice(0, 10),
      localEndDate: isoEnd.slice(0, 10),
      localStartTime: '00:00',
      localEndTime: '00:00',
      localStartMinutes: 0,
      localEndMinutes: 0,
    };
  }

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? undefined });
  } catch {
    const startTime = isoStart.slice(11, 16) || '00:00';
    const endTime = isoEnd.slice(11, 16) || '00:00';
    const [hS, mS] = startTime.split(':').map(Number);
    const [hE, mE] = endTime.split(':').map(Number);
    return {
      localStartDate: isoStart.slice(0, 10),
      localEndDate: isoEnd.slice(0, 10),
      localStartTime: startTime,
      localEndTime: endTime,
      localStartMinutes: (hS ?? 0) * 60 + (mS ?? 0),
      localEndMinutes: (hE ?? 0) * 60 + (mE ?? 0),
    };
  }

  const dateTimeFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const startParts = dateTimeFormat.formatToParts(dStart);
  const endParts = dateTimeFormat.formatToParts(dEnd);
  const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const yStart = getPart(startParts, 'year');
  const mStart = getPart(startParts, 'month');
  const dayStart = getPart(startParts, 'day');
  const yEnd = getPart(endParts, 'year');
  const mEnd = getPart(endParts, 'month');
  const dayEnd = getPart(endParts, 'day');
  const hS = parseInt(getPart(startParts, 'hour'), 10) || 0;
  const minS = parseInt(getPart(startParts, 'minute'), 10) || 0;
  const hE = parseInt(getPart(endParts, 'hour'), 10) || 0;
  const minE = parseInt(getPart(endParts, 'minute'), 10) || 0;

  const localStartDate = `${yStart}-${mStart}-${dayStart}`;
  const localEndDate = `${yEnd}-${mEnd}-${dayEnd}`;
  const localStartTime = `${String(hS).padStart(2, '0')}:${String(minS).padStart(2, '0')}`;
  const localEndTime = `${String(hE).padStart(2, '0')}:${String(minE).padStart(2, '0')}`;
  const localStartMinutes = hS * 60 + minS;
  const localEndMinutes = hE * 60 + minE;

  return {
    localStartDate,
    localEndDate,
    localStartTime,
    localEndTime,
    localStartMinutes,
    localEndMinutes,
  };
}

/**
 * Return the local date for an iCal event (for grouping by day).
 */
export function icalEventLocalStartDate(
  isoStart: string,
  allDay: boolean,
  timezone?: string
): string {
  if (allDay || isoStart.length <= 10) return isoStart.slice(0, 10);
  try {
    const { localStartDate } = icalEventToLocal(isoStart, isoStart, false, timezone);
    return localStartDate;
  } catch {
    return isoStart.slice(0, 10);
  }
}
