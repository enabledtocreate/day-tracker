'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type TimeSettings } from '@/lib/api';
import { parseSunIsoToMinutes, weatherTempUnitFromSettings } from '@/lib/weatherDisplay';

export type WeatherHourlyPoint = {
  timeIso: string;
  hour: number;
  dateStr: string;
  temp: number | null;
  precipPct: number | null;
  weatherCode: number;
};

export type WeatherDailyPoint = {
  dateStr: string;
  weatherCode: number;
  tempMax: number | null;
  tempMin: number | null;
  precipPctMax: number | null;
  sunriseMinutes: number | null;
  sunsetMinutes: number | null;
};

function localDateFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useScheduleWeather(
  settings: TimeSettings,
  dateFrom: string,
  dateTo: string
): {
  hourlyByDate: Record<string, WeatherHourlyPoint[]>;
  dailyByDate: Record<string, WeatherDailyPoint>;
  loading: boolean;
  hasCoords: boolean;
} {
  const lat = settings.weather_latitude;
  const lon = settings.weather_longitude;
  const hasCoords = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);
  const tempUnit = weatherTempUnitFromSettings(settings.weather_temp_unit);

  const [payload, setPayload] = useState<Awaited<ReturnType<typeof api.weather.get>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hasCoords || !dateFrom || !dateTo) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.weather
      .get(lat!, lon!, dateFrom, dateTo, tempUnit)
      .then((r) => {
        if (!cancelled) setPayload(r);
      })
      .catch(() => {
        if (!cancelled) setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasCoords, lat, lon, dateFrom, dateTo, tempUnit]);

  const { hourlyByDate, dailyByDate } = useMemo(() => {
    const hourlyByDate: Record<string, WeatherHourlyPoint[]> = {};
    const dailyByDate: Record<string, WeatherDailyPoint> = {};
    if (!payload) return { hourlyByDate, dailyByDate };

    const times = payload.hourly?.time ?? [];
    const temps = payload.hourly?.temperature_2m ?? [];
    const precips = payload.hourly?.precipitation_probability ?? [];
    const codes = payload.hourly?.weather_code ?? [];
    times.forEach((t, i) => {
      const dateStr = localDateFromIso(t);
      const hour = new Date(t).getHours();
      const pt: WeatherHourlyPoint = {
        timeIso: t,
        hour,
        dateStr,
        temp: temps[i] ?? null,
        precipPct: precips[i] ?? null,
        weatherCode: codes[i] ?? 0,
      };
      if (!hourlyByDate[dateStr]) hourlyByDate[dateStr] = [];
      hourlyByDate[dateStr]!.push(pt);
    });

    const dTimes = payload.daily?.time ?? [];
    dTimes.forEach((dateStr, i) => {
      dailyByDate[dateStr] = {
        dateStr,
        weatherCode: payload.daily?.weather_code?.[i] ?? 0,
        tempMax: payload.daily?.temperature_2m_max?.[i] ?? null,
        tempMin: payload.daily?.temperature_2m_min?.[i] ?? null,
        precipPctMax: payload.daily?.precipitation_probability_max?.[i] ?? null,
        sunriseMinutes: parseSunIsoToMinutes(payload.daily?.sunrise?.[i]),
        sunsetMinutes: parseSunIsoToMinutes(payload.daily?.sunset?.[i]),
      };
    });

    return { hourlyByDate, dailyByDate };
  }, [payload]);

  return { hourlyByDate, dailyByDate, loading, hasCoords };
}

export function pickHourlyForSlot(
  hourly: WeatherHourlyPoint[] | undefined,
  viewStartMinutes: number,
  slotIndex: number,
  slotDurationMinutes: number
): WeatherHourlyPoint | null {
  if (!hourly?.length) return null;
  const min = viewStartMinutes + slotIndex * slotDurationMinutes;
  const hour = Math.floor(min / 60) % 24;
  return hourly.find((h) => h.hour === hour) ?? hourly[0] ?? null;
}
