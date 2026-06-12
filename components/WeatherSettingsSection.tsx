'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type GeocodeResult, type TimeSettings } from '@/lib/api';
import { weatherTempUnitFromSettings, type WeatherTempUnit } from '@/lib/weatherDisplay';

type Props = {
  settings: TimeSettings;
  onSettingsChange: (s: TimeSettings) => void;
  loadSettings: () => void;
};

function formatGeocodeLabel(r: GeocodeResult): string {
  const parts = [r.name];
  if (r.admin1) parts.push(r.admin1);
  if (r.country) parts.push(r.country);
  return parts.filter(Boolean).join(', ');
}

export function WeatherSettingsSection({ settings, onSettingsChange, loadSettings }: Props) {
  const tempUnit = weatherTempUnitFromSettings(settings.weather_temp_unit);
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<GeocodeResult[]>([]);
  const [citySearching, setCitySearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchCities = useCallback((q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setCityResults([]);
      return;
    }
    setCitySearching(true);
    api.geocode
      .search(trimmed)
      .then((r) => setCityResults(r.results ?? []))
      .catch(() => setCityResults([]))
      .finally(() => setCitySearching(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchCities(cityQuery), 320);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [cityQuery, searchCities]);

  const hasCoords =
    settings.weather_latitude != null &&
    settings.weather_longitude != null &&
    Number.isFinite(settings.weather_latitude) &&
    Number.isFinite(settings.weather_longitude);

  const setTempUnit = (unit: WeatherTempUnit) => {
    onSettingsChange({ ...settings, weather_temp_unit: unit });
    void api.settings.update({ weather_temp_unit: unit }).then(loadSettings).catch(alert);
  };

  const selectCity = (r: GeocodeResult) => {
    const label = formatGeocodeLabel(r);
    onSettingsChange({
      ...settings,
      weather_latitude: r.latitude,
      weather_longitude: r.longitude,
      weather_location_label: label,
    });
    void api.settings
      .update({
        weather_latitude: r.latitude,
        weather_longitude: r.longitude,
        weather_location_label: label,
      })
      .then(() => {
        setCityQuery('');
        setCityResults([]);
        loadSettings();
      })
      .catch(alert);
  };

  const clearLocation = () => {
    onSettingsChange({
      ...settings,
      weather_latitude: null,
      weather_longitude: null,
      weather_location_label: null,
    });
    void api.settings
      .update({
        weather_latitude: null,
        weather_longitude: null,
        weather_location_label: null,
      })
      .then(loadSettings)
      .catch(alert);
  };

  return (
    <div className="user-settings-section">
      <h3 style={{ marginTop: 0 }}>Weather</h3>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        Controls the schedule weather lane (icons, temperature, and day/night gradient from sunrise to sunset).
      </p>

      <fieldset style={{ border: 'none', padding: 0, margin: '1.25rem 0 0' }}>
        <legend style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>Temperature</legend>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={'day-nav-btn' + (tempUnit === 'C' ? ' day-nav-btn-active' : '')}
            aria-pressed={tempUnit === 'C'}
            onClick={() => setTempUnit('C')}
          >
            °C
          </button>
          <button
            type="button"
            className={'day-nav-btn' + (tempUnit === 'F' ? ' day-nav-btn-active' : '')}
            aria-pressed={tempUnit === 'F'}
            onClick={() => setTempUnit('F')}
          >
            °F
          </button>
        </div>
      </fieldset>

      <fieldset style={{ border: 'none', padding: 0, margin: '1.75rem 0 0' }}>
        <legend style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.35rem' }}>Location</legend>
        {hasCoords && settings.weather_location_label ? (
          <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
            Current: <strong>{settings.weather_location_label}</strong>
          </p>
        ) : hasCoords ? (
          <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem', color: 'var(--text-muted)' }}>
            Coordinates set ({settings.weather_latitude?.toFixed(2)}, {settings.weather_longitude?.toFixed(2)})
          </p>
        ) : (
          <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem', color: 'var(--text-muted)' }}>
            No location set — the weather lane is hidden until you choose one below.
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <button
            type="button"
            className="day-nav-btn"
            onClick={() => {
              if (!navigator.geolocation) {
                alert('Geolocation is not available in this browser.');
                return;
              }
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  void api.settings
                    .update({
                      weather_latitude: pos.coords.latitude,
                      weather_longitude: pos.coords.longitude,
                      weather_location_label: 'My location',
                    })
                    .then(loadSettings)
                    .catch(alert);
                },
                () =>
                  alert(
                    'Could not read your location. Search for a city below, or allow location access in your browser settings and try again.'
                  ),
                { timeout: 10000 }
              );
            }}
          >
            Use my location
          </button>
          {hasCoords ? (
            <button type="button" className="day-nav-btn" onClick={clearLocation}>
              Clear location
            </button>
          ) : null}
        </div>

        <label style={{ display: 'block', fontSize: '0.9rem' }}>
          Search for a city
          <input
            type="search"
            value={cityQuery}
            onChange={(e) => setCityQuery(e.target.value)}
            placeholder="e.g. Minneapolis"
            autoComplete="off"
            style={{
              display: 'block',
              width: '100%',
              maxWidth: '22rem',
              marginTop: '0.35rem',
              padding: '0.4rem 0.5rem',
            }}
          />
        </label>
        {citySearching ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>Searching…</p>
        ) : null}
        {cityResults.length > 0 ? (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '0.35rem 0 0',
              maxWidth: '22rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {cityResults.map((r) => (
              <li key={`${r.id}-${r.latitude}-${r.longitude}`} style={{ borderBottom: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => selectCity(r)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.45rem 0.6rem',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  {formatGeocodeLabel(r)}
                </button>
              </li>
            ))}
          </ul>
        ) : cityQuery.trim().length >= 2 && !citySearching ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>No matches.</p>
        ) : null}
      </fieldset>
    </div>
  );
}
