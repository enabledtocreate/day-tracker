<?php
/**
 * Schedule block instances: GET/list, POST/create, PATCH/update, DELETE/delete.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/data_integrity.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$pdo->exec("CREATE TABLE IF NOT EXISTS task_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT,
    icon TEXT
)");
$pdo->exec("CREATE TABLE IF NOT EXISTS schedule_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_record_id INTEGER NOT NULL REFERENCES day_record(id) ON DELETE CASCADE,
    block_id INTEGER NOT NULL REFERENCES task_blocks(id) ON DELETE CASCADE,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
)");
$pdo->exec("CREATE INDEX IF NOT EXISTS idx_schedule_blocks_day ON schedule_blocks (day_record_id)");
$pdo->exec("CREATE INDEX IF NOT EXISTS idx_schedule_blocks_block ON schedule_blocks (block_id)");

if ($method === 'GET') {
    $dayId = isset($_GET['day_id']) ? (int) $_GET['day_id'] : 0;
    $fromDate = isset($_GET['from_date']) ? trim((string) $_GET['from_date']) : '';
    $toDate = isset($_GET['to_date']) ? trim((string) $_GET['to_date']) : '';

    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromDate) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $toDate)) {
        $stmt = $pdo->prepare("
            SELECT d.date, b.id, b.day_record_id, b.block_id, b.start_time, b.end_time, tb.name AS block_name, tb.color AS block_color, tb.icon AS block_icon
            FROM day_record d
            JOIN schedule_blocks b ON b.day_record_id = d.id
            JOIN task_blocks tb ON tb.id = b.block_id
            WHERE d.date >= ? AND d.date <= ?
            ORDER BY d.date, b.start_time, b.id
        ");
        $stmt->execute([$fromDate, $toDate]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $byDate = [];
        foreach ($rows as $row) {
            $date = (string) $row['date'];
            unset($row['date']);
            if (!isset($byDate[$date])) $byDate[$date] = [];
            $byDate[$date][] = $row;
        }
        jsonResponse(['byDate' => $byDate]);
        exit;
    }

    if ($dayId < 1) {
        jsonResponse(['blocks' => []]);
        exit;
    }
    $stmt = $pdo->prepare("
        SELECT b.id, b.day_record_id, b.block_id, b.start_time, b.end_time, tb.name AS block_name, tb.color AS block_color, tb.icon AS block_icon
        FROM schedule_blocks b
        JOIN task_blocks tb ON tb.id = b.block_id
        WHERE b.day_record_id = ?
        ORDER BY b.start_time, b.id
    ");
    $stmt->execute([$dayId]);
    jsonResponse(['blocks' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    exit;
}

if ($method === 'POST') {
    $in = readJsonInput();
    $dayRecordId = isset($in['day_record_id']) ? (int) $in['day_record_id'] : 0;
    $blockId = isset($in['block_id']) ? (int) $in['block_id'] : 0;
    $startTime = isset($in['start_time']) ? trim((string) $in['start_time']) : '';
    $endTime = isset($in['end_time']) ? trim((string) $in['end_time']) : '';
    if ($dayRecordId < 1 || $blockId < 1 || $startTime === '' || $endTime === '') {
        jsonError('day_record_id, block_id, start_time, end_time required');
        exit;
    }
    [$startTime, $endTime] = dataIntegrityCoerceSlotTimeFramePair($pdo, $startTime, $endTime);
    $stmt = $pdo->prepare("INSERT INTO schedule_blocks (day_record_id, block_id, start_time, end_time) VALUES (?, ?, ?, ?)");
    $stmt->execute([$dayRecordId, $blockId, $startTime, $endTime]);
    jsonResponse([
        'id' => (int) $pdo->lastInsertId(),
        'day_record_id' => $dayRecordId,
        'block_id' => $blockId,
        'start_time' => $startTime,
        'end_time' => $endTime,
    ]);
    exit;
}

if ($method === 'PATCH') {
    $in = readJsonInput();
    $id = isset($in['id']) ? (int) $in['id'] : 0;
    if ($id < 1) {
        jsonError('id required');
        exit;
    }
    $updates = [];
    $params = [];
    if (array_key_exists('block_id', $in)) {
        $updates[] = 'block_id = ?';
        $params[] = (int) $in['block_id'];
    }
    if (array_key_exists('start_time', $in) && array_key_exists('end_time', $in)) {
        $startVal = ($in['start_time'] === null || $in['start_time'] === '') ? null : (string) $in['start_time'];
        $endVal = ($in['end_time'] === null || $in['end_time'] === '') ? null : (string) $in['end_time'];
        [$startVal, $endVal] = dataIntegrityCoerceSlotTimeFramePair($pdo, $startVal, $endVal);
        $updates[] = 'start_time = ?';
        $params[] = $startVal;
        $updates[] = 'end_time = ?';
        $params[] = $endVal;
    } else {
        if (array_key_exists('start_time', $in)) {
            $updates[] = 'start_time = ?';
            $params[] = (string) $in['start_time'];
        }
        if (array_key_exists('end_time', $in)) {
            $updates[] = 'end_time = ?';
            $params[] = (string) $in['end_time'];
        }
    }
    if (empty($updates)) {
        jsonError('No fields to update');
        exit;
    }
    $params[] = $id;
    $pdo->prepare("UPDATE schedule_blocks SET " . implode(', ', $updates) . " WHERE id = ?")->execute($params);
    jsonResponse(['ok' => true]);
    exit;
}

if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id < 1) {
        jsonError('id required');
        exit;
    }
    $pdo->prepare("DELETE FROM schedule_blocks WHERE id = ?")->execute([$id]);
    jsonResponse(['ok' => true]);
    exit;
}

jsonError('Method not allowed', 405);
