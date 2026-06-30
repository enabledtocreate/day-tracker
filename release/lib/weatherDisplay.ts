import type { WeatherDailyPoint } from '@/lib/useScheduleWeather';

export type WeatherTempUnit = 'C' | 'F';

export function weatherTempUnitFromSettings(unit: string | undefined): WeatherTempUnit {
  return unit === 'F' ? 'F' : 'C';
}

/** Whether a schedule slot (minutes from local midnight) falls outside sunrise–sunset. */
export function isNightAtMinutes(
  minutes: number,
  sunriseMinutes?: number | null,
  sunsetMinutes?: number | null
): boolean {
  if (sunriseMinutes != null && sunsetMinutes != null) {
    return minutes < sunriseMinutes || minutes >= sunsetMinutes;
  }
  const hour = Math.floor(minutes / 60) % 24;
  return hour < 6 || hour >= 20;
}

/** Format temperature already in the user's unit (from Open-Meteo with matching temperature_unit). */
export function formatWeatherTemp(value: number | null | undefined, _unit: WeatherTempUnit): string {
  if (value == null || !Number.isFinite(value)) return '';
  return `${Math.round(value)}°`;
}

/** Minutes from local midnight for Open-Meteo sunrise/sunset ISO strings. */
export function parseSunIsoToMinutes(iso: string | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return d.getHours() * 60 + d.getMinutes();
  }
  const m = iso.match(/T(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  return Number.isFinite(h) && Number.isFinite(min) ? h * 60 + min : null;
}

/**
 * One vertical gradient for the full weather lane: night → day (sunrise–sunset) → night.
 * Positions are mapped to the visible schedule window [viewStartMinutes, viewEndMinutes].
 */
export function buildDaylightLaneGradient(
  viewStartMinutes: number,
  viewEndMinutes: number,
  daily?: WeatherDailyPoint
): string {
  const span = viewEndMinutes - viewStartMinutes;
  const night = '#1a3a5c';
  const nightMid = '#2d4f7a';
  const dayTop = '#fff9e6';
  const dayMid = '#fffdf5';

  if (span <= 0) {
    return `linear-gradient(180deg, ${night} 0%, ${dayTop} 50%, ${night} 100%)`;
  }

  let sr = daily?.sunriseMinutes ?? 6 * 60;
  let ss = daily?.sunsetMinutes ?? 20 * 60;
  sr = Math.max(viewStartMinutes, Math.min(viewEndMinutes, sr));
  ss = Math.max(viewStartMinutes, Math.min(viewEndMinutes, ss));

  if (ss <= sr) {
    return `linear-gradient(180deg, ${night} 0%, ${nightMid} 100%)`;
  }

  const srPct = ((sr - viewStartMinutes) / span) * 100;
  const ssPct = ((ss - viewStartMinutes) / span) * 100;
  const dawn = Math.max(0, srPct - 6);
  const dusk = Math.min(100, ssPct + 6);
  const mid = (srPct + ssPct) / 2;

  return `linear-gradient(180deg, ${night} 0%, ${nightMid} ${dawn}%, ${dayTop} ${srPct}%, ${dayMid} ${mid}%, ${dayTop} ${ssPct}%, ${nightMid} ${dusk}%, ${night} 100%)`;
}
