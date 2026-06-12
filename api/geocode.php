<?php
/**
 * Geocoding proxy (Open-Meteo Geocoding API, no API key). GET: q (search text).
 */
require_once __DIR__ . '/common.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    jsonError('Method not allowed', 405);
    exit;
}

$q = isset($_GET['q']) ? trim((string) $_GET['q']) : '';
if ($q === '' || strlen($q) < 2) {
    jsonResponse(['results' => []]);
    exit;
}
if (strlen($q) > 120) {
    jsonError('Query too long');
    exit;
}

$params = http_build_query([
    'name' => $q,
    'count' => 8,
    'language' => 'en',
    'format' => 'json',
]);

$url = 'https://geocoding-api.open-meteo.com/v1/search?' . $params;
$ctx = stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 10,
        'user_agent' => 'DayTracker/1.0',
    ],
]);
$raw = @file_get_contents($url, false, $ctx);
if ($raw === false) {
    jsonError('Geocoding service unavailable', 502);
    exit;
}
$data = json_decode($raw, true);
if (!is_array($data)) {
    jsonError('Invalid geocoding response', 502);
    exit;
}

$out = [];
foreach ($data['results'] ?? [] as $row) {
    if (!is_array($row)) {
        continue;
    }
    $lat = isset($row['latitude']) ? (float) $row['latitude'] : null;
    $lon = isset($row['longitude']) ? (float) $row['longitude'] : null;
    if ($lat === null || $lon === null || $lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        continue;
    }
    $out[] = [
        'id' => isset($row['id']) ? (int) $row['id'] : 0,
        'name' => isset($row['name']) ? (string) $row['name'] : '',
        'latitude' => $lat,
        'longitude' => $lon,
        'admin1' => isset($row['admin1']) ? (string) $row['admin1'] : '',
        'country' => isset($row['country']) ? (string) $row['country'] : '',
    ];
}

jsonResponse(['results' => $out]);
