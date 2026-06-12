<?php
/**
 * Weather proxy (Open-Meteo, no API key). GET: lat, lon, from, to (YYYY-MM-DD).
 */
require_once __DIR__ . '/common.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    jsonError('Method not allowed', 405);
    exit;
}

$lat = isset($_GET['lat']) ? (float) $_GET['lat'] : 0;
$lon = isset($_GET['lon']) ? (float) $_GET['lon'] : 0;
$from = isset($_GET['from']) ? trim((string) $_GET['from']) : '';
$to = isset($_GET['to']) ? trim((string) $_GET['to']) : '';
$tempUnit = isset($_GET['temp_unit']) ? strtolower(trim((string) $_GET['temp_unit'])) : '';

if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
    jsonError('Invalid lat/lon');
    exit;
}
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
    jsonError('from and to dates required (YYYY-MM-DD)');
    exit;
}

$query = [
    'latitude' => $lat,
    'longitude' => $lon,
    'start_date' => $from,
    'end_date' => $to,
    'timezone' => 'auto',
    'hourly' => 'temperature_2m,precipitation_probability,weather_code',
    'daily' => 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
];
if ($tempUnit === 'fahrenheit') {
    $query['temperature_unit'] = 'fahrenheit';
}
$q = http_build_query($query);

$url = 'https://api.open-meteo.com/v1/forecast?' . $q;
$ctx = stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 12,
        'user_agent' => 'DayTracker/1.0',
    ],
]);
$raw = @file_get_contents($url, false, $ctx);
if ($raw === false) {
    jsonError('Weather service unavailable', 502);
    exit;
}
$data = json_decode($raw, true);
if (!is_array($data)) {
    jsonError('Invalid weather response', 502);
    exit;
}

jsonResponse([
    'hourly' => [
        'time' => $data['hourly']['time'] ?? [],
        'temperature_2m' => $data['hourly']['temperature_2m'] ?? [],
        'precipitation_probability' => $data['hourly']['precipitation_probability'] ?? [],
        'weather_code' => $data['hourly']['weather_code'] ?? [],
    ],
    'daily' => [
        'time' => $data['daily']['time'] ?? [],
        'weather_code' => $data['daily']['weather_code'] ?? [],
        'temperature_2m_max' => $data['daily']['temperature_2m_max'] ?? [],
        'temperature_2m_min' => $data['daily']['temperature_2m_min'] ?? [],
        'precipitation_probability_max' => $data['daily']['precipitation_probability_max'] ?? [],
        'sunrise' => $data['daily']['sunrise'] ?? [],
        'sunset' => $data['daily']['sunset'] ?? [],
    ],
]);
