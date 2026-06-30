/** WMO weather interpretation codes (Open-Meteo). Returns Lucide-style icon key + short label. */
export function weatherCodeToIcon(
  code: number,
  opts?: { isNight?: boolean }
): { icon: string; label: string } {
  const night = opts?.isNight ?? false;
  if (code === 0) return { icon: night ? 'moon' : 'sun', label: 'Clear' };
  if (code === 1) return { icon: night ? 'moon' : 'sun', label: 'Mainly clear' };
  if (code === 2) return { icon: night ? 'cloud-moon' : 'cloud-sun', label: 'Partly cloudy' };
  if (code === 3) return { icon: 'cloud', label: 'Overcast' };
  if (code === 45 || code === 48) return { icon: 'cloud-fog', label: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: 'cloud-drizzle', label: 'Drizzle' };
  if (code >= 61 && code <= 67) return { icon: 'cloud-rain', label: 'Rain' };
  if (code >= 71 && code <= 77) return { icon: 'cloud-snow', label: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: 'cloud-rain', label: 'Showers' };
  if (code >= 85 && code <= 86) return { icon: 'cloud-snow', label: 'Snow showers' };
  if (code >= 95 && code <= 99) return { icon: 'cloud-lightning', label: 'Thunderstorm' };
  return { icon: 'cloud', label: 'Cloudy' };
}

/** Hour 0–23: rough day vs night for gradient (refined with sunrise/sunset when available). */
export function isNightHour(hour: number, sunriseHour?: number, sunsetHour?: number): boolean {
  if (sunriseHour != null && sunsetHour != null) {
    return hour < sunriseHour || hour >= sunsetHour;
  }
  return hour < 6 || hour >= 20;
}
