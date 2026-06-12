'use client';

import { DynamicIcon } from 'lucide-react/dynamic';
import type { IconName } from 'lucide-react/dynamic';
import {
  pickHourlyForSlot,
  type WeatherDailyPoint,
  type WeatherHourlyPoint,
} from '@/lib/useScheduleWeather';
import { buildDaylightLaneGradient, formatWeatherTemp, type WeatherTempUnit } from '@/lib/weatherDisplay';
import { weatherCodeToIcon } from '@/lib/weatherCodes';

type DayRowProps = {
  slotLabels: string[];
  rowHeightPx: number;
  viewStartMinutes: number;
  viewEndMinutes: number;
  slotDurationMinutes: number;
  hourly: WeatherHourlyPoint[] | undefined;
  daily: WeatherDailyPoint | undefined;
  tempUnit: WeatherTempUnit;
};

export function ScheduleWeatherDayRows({
  slotLabels,
  rowHeightPx,
  viewStartMinutes,
  viewEndMinutes,
  slotDurationMinutes,
  hourly,
  daily,
  tempUnit,
}: DayRowProps) {
  const laneGradient = buildDaylightLaneGradient(viewStartMinutes, viewEndMinutes, daily);

  return (
    <div
      className="schedule-weather-lane schedule-weather-lane-day"
      style={{ background: laneGradient }}
      aria-hidden
    >
      {slotLabels.map((_, i) => {
        const pt = pickHourlyForSlot(hourly, viewStartMinutes, i, slotDurationMinutes);
        const { icon } = weatherCodeToIcon(pt?.weatherCode ?? 0);
        const precip = pt?.precipPct;
        const temp = formatWeatherTemp(pt?.temp, tempUnit);
        const tip = precip != null ? `Precipitation: ${Math.round(precip)}%` : 'No precipitation data';
        return (
          <div key={i} className="schedule-weather-row" style={{ height: rowHeightPx }} title={tip}>
            <DynamicIcon name={icon as IconName} size={11} className="schedule-weather-row-icon" aria-hidden />
            {temp ? <span className="schedule-weather-row-temp">{temp}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

type WeekHeadProps = {
  dates: string[];
  dailyByDate: Record<string, WeatherDailyPoint>;
  tempUnit: WeatherTempUnit;
};

export function ScheduleWeatherWeekHeads({ dates, dailyByDate, tempUnit }: WeekHeadProps) {
  return (
    <>
      {dates.map((dateStr) => {
        const daily = dailyByDate[dateStr];
        const { icon } = weatherCodeToIcon(daily?.weatherCode ?? 0);
        const precip = daily?.precipPctMax;
        const tip = precip != null ? `Precipitation: ${Math.round(precip)}%` : 'No precipitation data';
        const hi = daily?.tempMax != null ? formatWeatherTemp(daily.tempMax, tempUnit) : '—';
        const lo = daily?.tempMin != null ? formatWeatherTemp(daily.tempMin, tempUnit) : '—';
        return (
          <div key={dateStr} className="schedule-weather-week-head" title={tip}>
            <DynamicIcon name={icon as IconName} size={13} className="schedule-weather-week-icon" aria-hidden />
            <div className="schedule-weather-week-temps">
              <span className="schedule-weather-week-hi">{hi}</span>
              <span className="schedule-weather-week-lo">{lo}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}


