<?php
/**
 * iCal feed URL: GET returns { "token": "..." } for the current user's private feed.
 * Token is stored in master DB; ical.php uses it to serve the calendar without session.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    logMessage('WARNING', 'ical_feed method not allowed');
    header('Allow: GET', true, 405);
    exit;
}

logMessage('INFO', 'ical_feed.php GET');
$user = getCurrentUser();
$userId = (int) $user['id'];
$master = getMasterPdo();

$master->exec("CREATE TABLE IF NOT EXISTS ical_feed_tokens (user_id INTEGER PRIMARY KEY, token TEXT NOT NULL)");

$stmt = $master->prepare('SELECT token FROM ical_feed_tokens WHERE user_id = ?');
$stmt->execute([$userId]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if ($row) {
    $token = $row['token'];
    logMessage('INFO', 'ical_feed token ok existing', ['user_id' => $userId]);
} else {
    $token = bin2hex(random_bytes(24));
    $master->prepare('INSERT INTO ical_feed_tokens (user_id, token) VALUES (?, ?)')->execute([$userId, $token]);
    logMessage('INFO', 'ical_feed token ok created', ['user_id' => $userId]);
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode(['token' => $token]);
