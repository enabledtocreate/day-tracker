<?php
/**
 * Public iCal feed. No session required. Use ?token=... from api/ical_feed.php.
 * Serves scheduled slots as VEVENTs so calendar apps (e.g. Google Calendar) can subscribe.
 */
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/logger.php';

$token = isset($_GET['token']) ? trim((string) $_GET['token']) : '';
if ($token === '') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Calendar feed not found.';
    exit;
}

try {
    $master = getMasterPdo();
    $dataDir = getDataDir();
} catch (Throwable $e) {
    logError('ERROR', $e->getMessage(), ['file' => $e->getFile(), 'line' => $e->getLine(), 'context' => 'ical.php init']);
    http_response_code(503);
    exit;
}
try {
    $stmt = $master->prepare('SELECT user_id FROM ical_feed_tokens WHERE token = ?');
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    logError('WARNING', $e->getMessage(), ['file' => $e->getFile(), 'line' => $e->getLine(), 'context' => 'ical.php token lookup']);
    $row = null;
}
if (!$row) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Calendar feed not found.';
    exit;
}

$userId = (int) $row['user_id'];
$stmt = $master->prepare('SELECT db_name FROM users WHERE id = ?');
$stmt->execute([$userId]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$user) {
    http_response_code(404);
    exit;
}

$userDbPath = $dataDir . DIRECTORY_SEPARATOR . $user['db_name'];
if (!is_file($userDbPath)) {
    http_response_code(404);
    exit;
}

$pdo = new PDO('sqlite:' . $userDbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
runMigrationsIn($pdo, __DIR__ . '/migrations');

$from = date('Y-m-d', strtotime('-1 year'));
$to = date('Y-m-d', strtotime('+2 years'));

$stmt = $pdo->prepare("
    SELECT d.date, s.id, s.start_time, s.end_time, s.completed, t.title
    FROM day_record d
    JOIN scheduled_slots s ON s.day_record_id = d.id
    JOIN tasks t ON t.id = s.task_id
    WHERE d.date >= ? AND d.date <= ?
    ORDER BY d.date, s.start_time, COALESCE(s.order_index, 0)
");
$stmt->execute([$from, $to]);
$slots = $stmt->fetchAll(PDO::FETCH_ASSOC);

function icalEscape(string $s): string {
    $s = str_replace(['\\', ';', ',', "\r\n", "\n"], ['\\\\', '\\;', '\\,', '\\n', '\\n'], $s);
    return $s;
}

function icalFold(string $line): string {
    $crlf = "\r\n";
    $out = '';
    while (strlen($line) > 75) {
        $out .= substr($line, 0, 75) . $crlf . ' ';
        $line = substr($line, 75);
    }
    return $out . $line;
}

function toIcalDateTime(string $date, string $time): string {
    $parts = explode(':', trim($time));
    $h = isset($parts[0]) ? (int) $parts[0] : 0;
    $m = isset($parts[1]) ? (int) $parts[1] : 0;
    $s = isset($parts[2]) ? (int) $parts[2] : 0;
    return str_replace('-', '', $date) . 'T' . sprintf('%02d%02d%02d', $h, $m, $s);
}

$host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'daytracker';
$now = gmdate('Ymd\THis\Z');

header('Content-Type: text/calendar; charset=utf-8');
header('Cache-Control: public, max-age=60');
header('Content-Disposition: inline; filename="daytracker.ics"');

echo "BEGIN:VCALENDAR\r\n";
echo "VERSION:2.0\r\n";
echo "PRODID:-//Day Tracker//EN\r\n";
echo "CALSCALE:GREGORIAN\r\n";

foreach ($slots as $slot) {
    $date = $slot['date'];
    $start = toIcalDateTime($date, $slot['start_time']);
    $end = toIcalDateTime($date, $slot['end_time']);
    $title = icalEscape($slot['title'] ?? 'Task');
    if ((int) $slot['completed'] === 1) {
        $title = '[Done] ' . $title;
    }
    $uid = 'daytracker-slot-' . $slot['id'] . '@' . $host;
    echo "BEGIN:VEVENT\r\n";
    echo icalFold('UID:' . $uid) . "\r\n";
    echo 'DTSTAMP:' . $now . "\r\n";
    echo 'DTSTART:' . $start . "\r\n";
    echo 'DTEND:' . $end . "\r\n";
    echo icalFold('SUMMARY:' . $title) . "\r\n";
    echo "END:VEVENT\r\n";
}

echo "END:VCALENDAR\r\n";
