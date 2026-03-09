<?php
/**
 * Demo account: reset user DB and seed with variety of tasks/slots for current day.
 * Regenerates ical feed token so old links stop working.
 */
require_once __DIR__ . '/db.php';

function getDemoUserId(PDO $master): ?int {
    $stmt = $master->prepare('SELECT id FROM users WHERE username = ?');
    $stmt->execute(['demo']);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ? (int) $row['id'] : null;
}

function ensureDemoUserExists(PDO $master, string $dataDir): int {
    $stmt = $master->prepare('SELECT id, db_name FROM users WHERE username = ?');
    $stmt->execute(['demo']);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        return (int) $row['id'];
    }
    $dbName = 'daytracker_demo.sqlite';
    $hash = password_hash('demo', PASSWORD_DEFAULT);
    $master->prepare('INSERT INTO users (username, password_hash, db_name, is_admin) VALUES (?, ?, ?, 0)')
        ->execute(['demo', $hash, $dbName]);
    $userId = (int) $master->lastInsertId();
    $userPath = $dataDir . '/' . $dbName;
    $pdo = new PDO('sqlite:' . $userPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    runMigrationsIn($pdo, dirname(__DIR__) . '/migrations');
    return $userId;
}

function resetDemoUser(PDO $master, string $dataDir): void {
    $stmt = $master->prepare('SELECT id, db_name FROM users WHERE username = ?');
    $stmt->execute(['demo']);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return;
    }
    $userId = (int) $row['id'];
    $userPath = $dataDir . '/' . $row['db_name'];
    if (!is_file($userPath)) {
        $pdo = new PDO('sqlite:' . $userPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        runMigrationsIn($pdo, dirname(__DIR__) . '/migrations');
    }
    $pdo = new PDO('sqlite:' . $userPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    runMigrationsIn($pdo, dirname(__DIR__) . '/migrations');

    $today = date('Y-m-d');
    $yesterday = date('Y-m-d', strtotime($today . ' -1 day'));
    $tomorrow = date('Y-m-d', strtotime($today . ' +1 day'));

    $pdo->exec('DELETE FROM scheduled_slots');
    $pdo->exec('DELETE FROM task_list_items');
    $pdo->exec('DELETE FROM task_links');
    $pdo->exec('DELETE FROM tasks');
    $pdo->exec('DELETE FROM day_record');
    try {
        $pdo->exec('DELETE FROM ical_subscriptions');
    } catch (Throwable $e) {
        // table may not exist in older DBs
    }

    // Day records: two weeks around today (7 past, today, 6 future)
    $dayDates = [];
    for ($i = -7; $i <= 6; $i++) {
        $dayDates[] = date('Y-m-d', strtotime($today . " $i days"));
    }
    $dayPlaceholders = implode(',', array_fill(0, count($dayDates), '(?)'));
    $dayStmt = $pdo->prepare("INSERT INTO day_record (date) VALUES $dayPlaceholders");
    $dayStmt->execute($dayDates);
    $dayIds = [];
    foreach ($pdo->query('SELECT id, date FROM day_record ORDER BY date')->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $dayIds[$r['date']] = (int) $r['id'];
    }
    $todayId = $dayIds[$today];
    $yesterdayId = $dayIds[$yesterday];
    $tomorrowId = $dayIds[$tomorrow] ?? null;

    $taskIns = $pdo->prepare('INSERT INTO tasks (title, priority, recurring, parent_id, list_state, list_style) VALUES (?, ?, ?, ?, ?, ?)');
    // Use only high/medium/low so seed works even if migration 008 (commitment) not yet applied
    $tasks = [
        ['Review priorities', 'high', 0, null, 'pending', 'bullet'],
        ['Check email', 'medium', 1, null, 'unassigned', 'bullet'],
        ['Exercise', 'high', 1, null, 'unassigned', 'bullet'],
        ['Project Alpha – design', 'high', 0, null, 'pending', 'checklist'],
        ['Project Alpha – implement', 'high', 0, null, 'unassigned', 'bullet'],
        ['Call with team', 'medium', 0, null, 'unassigned', 'bullet'],
        ['Read docs', 'low', 0, null, 'unassigned', 'bullet'],
        ['Fix bug #42', 'high', 0, null, 'unassigned', 'bullet'],
        ['Subtasks for Alpha', 'medium', 0, null, 'unassigned', 'bullet'],
        ['Backup files', 'low', 1, null, 'unassigned', 'bullet'],
        ['Optional: learn new API', 'low', 0, null, 'pending', 'bullet'],
        // Evening and spread-across-calendar tasks
        ['Evening review', 'medium', 0, null, 'pending', 'bullet'],
        ['Dinner prep', 'low', 0, null, 'unassigned', 'bullet'],
        ['Wind down / no screens', 'low', 1, null, 'unassigned', 'bullet'],
        ['Weekly planning', 'high', 0, null, 'pending', 'checklist'],
        ['Weekly planning – review goals', 'medium', 0, null, 'unassigned', 'bullet'],
        ['Weekly planning – block focus time', 'medium', 0, null, 'unassigned', 'bullet'],
        ['Sync with design', 'medium', 0, null, 'unassigned', 'bullet'],
        ['Document API', 'low', 0, null, 'unassigned', 'bullet'],
        ['Deploy staging', 'high', 0, null, 'pending', 'bullet'],
        ['Retro notes', 'low', 0, null, 'unassigned', 'bullet'],
        ['Prep for meeting', 'medium', 0, null, 'unassigned', 'bullet'],
        ['Follow-up emails', 'low', 0, null, 'pending', 'bullet'],
    ];
    $projectAlphaId = null;
    $weeklyPlanningId = null;
    foreach ($tasks as $row) {
        $taskIns->execute($row);
        if ($row[0] === 'Project Alpha – design') {
            $projectAlphaId = (int) $pdo->lastInsertId();
        }
        if ($row[0] === 'Weekly planning') {
            $weeklyPlanningId = (int) $pdo->lastInsertId();
        }
    }
    if ($projectAlphaId) {
        $subtaskId = $pdo->query("SELECT id FROM tasks WHERE title = 'Subtasks for Alpha'")->fetchColumn();
        if ($subtaskId) {
            $pdo->prepare('UPDATE tasks SET parent_id = ? WHERE id = ?')->execute([$projectAlphaId, $subtaskId]);
        }
    }
    if ($weeklyPlanningId) {
        foreach (['Weekly planning – review goals', 'Weekly planning – block focus time'] as $sub) {
            $sid = $pdo->query("SELECT id FROM tasks WHERE title = " . $pdo->quote($sub))->fetchColumn();
            if ($sid) {
                $pdo->prepare('UPDATE tasks SET parent_id = ? WHERE id = ?')->execute([$weeklyPlanningId, $sid]);
            }
        }
    }
    $taskIds = $pdo->query('SELECT id, title FROM tasks ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    $idByTitle = [];
    foreach ($taskIds as $t) {
        $idByTitle[$t['title']] = (int) $t['id'];
    }
    $subtaskId = $idByTitle['Subtasks for Alpha'] ?? null;
    if ($subtaskId && $projectAlphaId) {
        $pdo->prepare('UPDATE tasks SET parent_id = ? WHERE id = ?')->execute([$projectAlphaId, $subtaskId]);
    }

    // Links: multiple tasks with links
    $linkTaskId = $idByTitle['Fix bug #42'] ?? $taskIds[0]['id'] ?? 1;
    $pdo->prepare('INSERT INTO task_links (task_id, url, description) VALUES (?, ?, ?)')
        ->execute([$linkTaskId, 'https://example.com/ticket/42', 'Ticket #42']);
    $pdo->prepare('INSERT INTO task_links (task_id, url, description) VALUES (?, ?, ?)')
        ->execute([$linkTaskId, 'https://docs.example.com/debug', 'Debug guide']);
    $syncTaskId = $idByTitle['Sync with design'] ?? null;
    if ($syncTaskId) {
        $pdo->prepare('INSERT INTO task_links (task_id, url, description) VALUES (?, ?, ?)')
            ->execute([$syncTaskId, 'https://figma.com/design/abc', 'Figma file']);
    }
    $docTaskId = $idByTitle['Document API'] ?? null;
    if ($docTaskId) {
        $pdo->prepare('INSERT INTO task_links (task_id, url, description) VALUES (?, ?, ?)')
            ->execute([$docTaskId, 'https://api.example.com/docs', 'API docs']);
    }

    // Checklists: Project Alpha – design (existing) + Weekly planning
    $checklistTaskId = $idByTitle['Project Alpha – design'] ?? $taskIds[0]['id'] ?? 1;
    $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)')
        ->execute([$checklistTaskId, 'Sketch wireframes', 0, 1]);
    $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)')
        ->execute([$checklistTaskId, 'Get feedback', 1, 0]);
    $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)')
        ->execute([$checklistTaskId, 'Finalize mockups', 2, 0]);
    $weeklyPlanTaskId = $idByTitle['Weekly planning'] ?? null;
    if ($weeklyPlanTaskId) {
        $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)')
            ->execute([$weeklyPlanTaskId, 'List top 3 goals', 0, 0]);
        $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)')
            ->execute([$weeklyPlanTaskId, 'Block deep work', 1, 0]);
        $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)')
            ->execute([$weeklyPlanTaskId, 'Schedule 1:1s', 2, 0]);
    }

    $slotIns = $pdo->prepare('INSERT INTO scheduled_slots (day_record_id, task_id, start_time, end_time, completed, order_index) VALUES (?, ?, ?, ?, ?, ?)');
    $startTimeNullable = false;
    foreach ($pdo->query('PRAGMA table_info(scheduled_slots)')->fetchAll(PDO::FETCH_ASSOC) as $col) {
        if (($col['name'] ?? '') === 'start_time' && (int) ($col['notnull'] ?? 1) === 0) {
            $startTimeNullable = true;
            break;
        }
    }
    $untimedStart = $startTimeNullable ? null : '09:00';
    $untimedEnd = $startTimeNullable ? null : '09:15';

    $rid = fn ($t) => $idByTitle[$t] ?? 0;
    $slots = [
        // Yesterday: some completed, one incomplete (for Incomplete section)
        [$yesterdayId, $rid('Review priorities'), '08:00', '08:15', 1, 0],
        [$yesterdayId, $rid('Check email'), '08:15', '08:30', 1, 1],
        [$yesterdayId, $rid('Project Alpha – design'), $untimedStart, $untimedEnd, 0, 2],
        [$yesterdayId, $rid('Fix bug #42'), '14:00', '14:30', 1, 3],
        [$yesterdayId, $rid('Evening review'), '18:00', '18:30', 0, 4],
        // Today: mix morning, afternoon, evening; some with children/links/lists
        [$todayId, $rid('Review priorities'), '08:00', '08:15', 1, 0],
        [$todayId, $rid('Check email'), '08:15', '08:45', 1, 1],
        [$todayId, $rid('Exercise'), '09:00', '09:45', 0, 2],
        [$todayId, $rid('Project Alpha – design'), $untimedStart, $untimedEnd, 0, 3],
        [$todayId, $rid('Project Alpha – implement'), '10:00', '11:00', 0, 4],
        [$todayId, $rid('Call with team'), '11:00', '11:30', 0, 5],
        [$todayId, $rid('Read docs'), $untimedStart, $untimedEnd, 0, 6],
        [$todayId, $rid('Fix bug #42'), '14:00', '15:00', 0, 7],
        [$todayId, $rid('Sync with design'), '15:30', '16:00', 0, 8],
        [$todayId, $rid('Evening review'), '18:00', '18:30', 0, 9],
        [$todayId, $rid('Dinner prep'), '18:30', '19:00', 0, 10],
        [$todayId, $rid('Wind down / no screens'), '21:00', '21:30', 0, 11],
    ];
    if ($tomorrowId) {
        $slots[] = [$tomorrowId, $rid('Weekly planning'), '09:00', '10:00', 0, 0];
        $slots[] = [$tomorrowId, $rid('Deploy staging'), '14:00', '15:00', 0, 1];
        $slots[] = [$tomorrowId, $rid('Evening review'), '18:00', '18:30', 0, 2];
    }
    $otherDates = array_diff_key($dayIds, array_flip([$yesterday, $today, $tomorrow]));
    $otherDateIds = array_values($otherDates);
    if (count($otherDateIds) >= 3) {
        $slots[] = [$otherDateIds[0], $rid('Call with team'), '10:00', '10:30', 0, 0];
        $slots[] = [$otherDateIds[1], $rid('Prep for meeting'), '11:00', '11:30', 0, 0];
        $slots[] = [$otherDateIds[2], $rid('Retro notes'), '16:00', '16:30', 0, 0];
        $idx = min(3, count($otherDateIds) - 1);
        $slots[] = [$otherDateIds[$idx], $rid('Follow-up emails'), '17:00', '17:30', 0, 0];
    }
    foreach ($slots as $s) {
        if ($s[1] > 0) {
            $slotIns->execute($s);
        }
    }

    $master->exec("CREATE TABLE IF NOT EXISTS ical_feed_tokens (user_id INTEGER PRIMARY KEY, token TEXT NOT NULL)");
    $newToken = bin2hex(random_bytes(24));
    $master->prepare('INSERT OR REPLACE INTO ical_feed_tokens (user_id, token) VALUES (?, ?)')->execute([$userId, $newToken]);

    // Always set demo password to "demo" so it is predictable for try-before-signup
    $demoHash = password_hash('demo', PASSWORD_DEFAULT);
    $master->prepare('UPDATE users SET password_hash = ?, force_password_reset = 0 WHERE id = ?')->execute([$demoHash, $userId]);
}

function setDemoLastResetDate(PDO $master, string $date): void {
    $master->prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')->execute(['demo_last_reset_date', $date]);
}

function getDemoLastResetDate(PDO $master): ?string {
    $stmt = $master->query("SELECT value FROM app_settings WHERE key = 'demo_last_reset_date'");
    $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
    return $row ? $row['value'] : null;
}

function isDemoUser(array $user): bool {
    return isset($user['username']) && $user['username'] === 'demo';
}
