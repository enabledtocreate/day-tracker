<?php
/**
 * Demo account: reset user DB and seed with variety of tasks/slots for current day.
 * Regenerates ical feed token so old links stop working.
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/logger.php';

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
        logMessage('NOTICE', 'demo_seed: DELETE ical_subscriptions skipped', ['message' => $e->getMessage()]);
    }
    $hasScheduleBlocks = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schedule_blocks'")->fetchColumn();
    if ($hasScheduleBlocks) {
        $pdo->exec('DELETE FROM schedule_blocks');
    }
    $hasTaskBlocks = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_blocks'")->fetchColumn();
    if ($hasTaskBlocks) {
        $pdo->exec('DELETE FROM task_blocks');
    }
    try {
        $pdo->exec('DELETE FROM recurring_occurrence_state');
    } catch (Throwable $e) {
        logMessage('NOTICE', 'demo_seed: DELETE recurring_occurrence_state skipped', ['message' => $e->getMessage()]);
    }
    // Clear organization tables (migration 016); skip if tables don't exist
    $hasOrg = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_categories'")->fetchColumn();
    if ($hasOrg) {
        $pdo->exec('DELETE FROM task_tag');
        $pdo->exec('DELETE FROM task_subcategory');
        $pdo->exec('DELETE FROM task_category');
        $pdo->exec('DELETE FROM task_tags');
        $pdo->exec('DELETE FROM task_subcategories');
        $pdo->exec('DELETE FROM task_categories');
    }
    $hasFavoriteFolder = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='favorite_folder'")->fetchColumn();
    if ($hasFavoriteFolder) {
        $pdo->exec('DELETE FROM favorite_folder');
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

    $taskColNames = array_column($pdo->query('PRAGMA table_info(tasks)')->fetchAll(PDO::FETCH_ASSOC), 'name');
    $hasIsCommon = in_array('is_common', $taskColNames, true);
    $hasGroupOrder = in_array('group_order', $taskColNames, true);
    $hasDefaultBlock = in_array('default_block_id', $taskColNames, true);
    $hasCommitment = (bool) $pdo->query("SELECT 1 FROM schema_migrations WHERE filename = '008_priority_commitment.sql'")->fetchColumn();
    $topPriority = $hasCommitment ? 'commitment' : 'high';

    $taskIns = $pdo->prepare('INSERT INTO tasks (title, priority, recurring, parent_id, list_state, list_style) VALUES (?, ?, ?, ?, ?, ?)');
    $tasks = [
        ['Review priorities', $topPriority, 0, null, 'pending', 'bullet'],
        ['Check email', 'medium', 1, null, 'unassigned', 'bullet'],
        ['Exercise', 'high', 1, null, 'unassigned', 'bullet'],
        ['Project Alpha – design', 'high', 0, null, 'pending', 'checklist'],
        ['Project Alpha – implement', 'high', 0, null, 'unassigned', 'bullet'],
        ['Call with team', 'medium', 0, null, 'unassigned', 'bullet'],
        ['Read docs', 'low', 0, null, 'unassigned', 'bullet'],
        ['Fix bug #42', 'high', 0, null, 'unassigned', 'bullet'],
        ['Client launch', $topPriority, 0, null, 'pending', 'bullet'],
        ['Final QA', 'high', 0, null, 'unassigned', 'bullet'],
        ['Send announcement', 'medium', 0, null, 'unassigned', 'bullet'],
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
    $weeklyPlanningId = null;
    $clientLaunchId = null;
    foreach ($tasks as $row) {
        $taskIns->execute($row);
        if ($row[0] === 'Weekly planning') {
            $weeklyPlanningId = (int) $pdo->lastInsertId();
        }
        if ($row[0] === 'Client launch') {
            $clientLaunchId = (int) $pdo->lastInsertId();
        }
    }
    if ($weeklyPlanningId) {
        $groupOrder = 0;
        foreach (['Weekly planning – review goals', 'Weekly planning – block focus time'] as $sub) {
            $sid = $pdo->query("SELECT id FROM tasks WHERE title = " . $pdo->quote($sub))->fetchColumn();
            if ($sid) {
                if ($hasGroupOrder) {
                    $pdo->prepare('UPDATE tasks SET parent_id = ?, group_order = ? WHERE id = ?')->execute([$weeklyPlanningId, $groupOrder, $sid]);
                } else {
                    $pdo->prepare('UPDATE tasks SET parent_id = ? WHERE id = ?')->execute([$weeklyPlanningId, $sid]);
                }
                $groupOrder++;
            }
        }
    }
    if ($clientLaunchId) {
        $groupOrder = 0;
        foreach (['Final QA', 'Send announcement'] as $member) {
            $mid = $pdo->query("SELECT id FROM tasks WHERE title = " . $pdo->quote($member))->fetchColumn();
            if ($mid) {
                if ($hasGroupOrder) {
                    $pdo->prepare('UPDATE tasks SET parent_id = ?, group_order = ? WHERE id = ?')->execute([$clientLaunchId, $groupOrder, $mid]);
                } else {
                    $pdo->prepare('UPDATE tasks SET parent_id = ? WHERE id = ?')->execute([$clientLaunchId, $mid]);
                }
                $groupOrder++;
            }
        }
    }
    if ($hasIsCommon) {
        $commonTemplates = [
            ['Daily standup prep', 'medium', 1, 'bullet'],
            ['Client kickoff checklist', 'high', 0, 'checklist'],
            ['Quick expense log', 'low', 0, 'bullet'],
        ];
        $commonIns = $pdo->prepare('INSERT INTO tasks (title, priority, recurring, parent_id, list_state, list_style, is_common) VALUES (?, ?, ?, NULL, ?, ?, 1)');
        foreach ($commonTemplates as [$title, $priority, $recurring, $listStyle]) {
            $commonIns->execute([$title, $priority, $recurring, 'unassigned', $listStyle]);
        }
    }
    $taskIds = $pdo->query('SELECT id, title FROM tasks ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
    $idByTitle = [];
    foreach ($taskIds as $t) {
        $idByTitle[$t['title']] = (int) $t['id'];
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
    $kickoffTemplateId = $idByTitle['Client kickoff checklist'] ?? null;
    if ($kickoffTemplateId) {
        $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)')
            ->execute([$kickoffTemplateId, 'Send agenda', 0, 0]);
        $pdo->prepare('INSERT INTO task_list_items (task_id, content, order_index, completed) VALUES (?, ?, ?, ?)')
            ->execute([$kickoffTemplateId, 'Confirm attendees', 1, 0]);
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
        // Task group on schedule (Client launch + members; child starts = internal boundaries)
        [$todayId, $rid('Client launch'), '16:15', '17:15', 0, 9],
        [$todayId, $rid('Final QA'), '16:30', '16:45', 0, 10],
        [$todayId, $rid('Send announcement'), '16:45', '17:15', 0, 11],
        [$todayId, $rid('Evening review'), '18:00', '18:30', 0, 12],
        [$todayId, $rid('Dinner prep'), '18:30', '19:00', 0, 13],
        [$todayId, $rid('Wind down / no screens'), '21:00', '21:30', 0, 14],
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
    // Current calendar week (Sun–Sat): at least one slot per day for Week view
    $weekDow = (int) date('w', strtotime($today));
    $weekSunday = date('Y-m-d', strtotime($today . " -$weekDow days"));
    $weekSlotTasks = [
        $rid('Review priorities'),
        $rid('Exercise'),
        $rid('Call with team'),
        $rid('Project Alpha – implement'),
        $rid('Fix bug #42'),
        $rid('Deploy staging'),
        $rid('Evening review'),
    ];
    for ($i = 0; $i < 7; $i++) {
        $weekDate = date('Y-m-d', strtotime($weekSunday . " +$i days"));
        if (!isset($dayIds[$weekDate]) || $weekDate === $today || $weekDate === $yesterday || $weekDate === $tomorrow) {
            continue;
        }
        $taskId = $weekSlotTasks[$i] ?? 0;
        if ($taskId > 0) {
            $startHour = 9 + ($i % 3);
            $slots[] = [$dayIds[$weekDate], $taskId, sprintf('%02d:00', $startHour), sprintf('%02d:30', $startHour), $weekDate < $today ? 1 : 0, 0];
        }
    }
    foreach ($slots as $s) {
        if ($s[1] > 0) {
            $slotIns->execute($s);
        }
    }

    // Organization: categories, subcategories, tags, blocks, and task assignments
    $blockDeep = null;
    $blockMeetings = null;
    $blockPersonal = null;
    if ($hasOrg) {
        $catCols = array_column($pdo->query('PRAGMA table_info(task_categories)')->fetchAll(PDO::FETCH_ASSOC), 'name');
        $hasCatIcon = in_array('icon', $catCols, true);
        if ($hasCatIcon) {
            $pdo->prepare('INSERT INTO task_categories (name, color, icon) VALUES (?, ?, ?)')->execute(['Work', '#00c853', 'briefcase']);
        } else {
            $pdo->prepare('INSERT INTO task_categories (name, color) VALUES (?, ?)')->execute(['Work', '#00c853']);
        }
        $catWork = (int) $pdo->lastInsertId();
        if ($hasCatIcon) {
            $pdo->prepare('INSERT INTO task_categories (name, color, icon) VALUES (?, ?, ?)')->execute(['Personal', '#18b4e8', 'home']);
            $catPersonal = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO task_categories (name, color, icon) VALUES (?, ?, ?)')->execute(['Health', '#ff6b6b', 'heart']);
        } else {
            $pdo->prepare('INSERT INTO task_categories (name, color) VALUES (?, ?)')->execute(['Personal', '#18b4e8']);
            $catPersonal = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO task_categories (name, color) VALUES (?, ?)')->execute(['Health', '#ff6b6b']);
        }
        $catHealth = (int) $pdo->lastInsertId();

        $pdo->prepare('INSERT INTO task_subcategories (category_id, name) VALUES (?, ?)')->execute([$catWork, 'Meetings']);
        $subMeetings = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO task_subcategories (category_id, name) VALUES (?, ?)')->execute([$catWork, 'Deep work']);
        $subDeepWork = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO task_subcategories (category_id, name) VALUES (?, ?)')->execute([$catPersonal, 'Chores']);
        $subChores = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO task_subcategories (category_id, name) VALUES (?, ?)')->execute([$catHealth, 'Exercise']);
        $subExercise = (int) $pdo->lastInsertId();

        $pdo->prepare('INSERT INTO task_tags (name, color) VALUES (?, ?)')->execute(['urgent', 'hsl(0,65%,50%)']);
        $tagUrgent = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO task_tags (name, color) VALUES (?, ?)')->execute(['this-week', 'hsl(200,65%,50%)']);
        $tagThisWeek = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO task_tags (name, color) VALUES (?, ?)')->execute(['focus', null]);
        $tagFocus = (int) $pdo->lastInsertId();

        $taskCatStmt = $pdo->prepare('INSERT INTO task_category (task_id, category_id) VALUES (?, ?)');
        $taskSubStmt = $pdo->prepare('INSERT INTO task_subcategory (task_id, subcategory_id) VALUES (?, ?)');
        $taskTagStmt = $pdo->prepare('INSERT INTO task_tag (task_id, tag_id) VALUES (?, ?)');
        $rid = fn ($t) => $idByTitle[$t] ?? null;
        $assign = function (string $title, int $catId, ?int $subId, array $tagIds) use ($rid, $taskCatStmt, $taskSubStmt, $taskTagStmt) {
            $tid = $rid($title);
            if ($tid === null) return;
            $taskCatStmt->execute([$tid, $catId]);
            if ($subId !== null) $taskSubStmt->execute([$tid, $subId]);
            foreach ($tagIds as $tagId) $taskTagStmt->execute([$tid, $tagId]);
        };
        $assign('Fix bug #42', $catWork, null, [$tagUrgent]);
        $assign('Project Alpha – design', $catWork, $subDeepWork, [$tagThisWeek]);
        $assign('Project Alpha – implement', $catWork, $subDeepWork, [$tagThisWeek]);
        $assign('Call with team', $catWork, $subMeetings, []);
        $assign('Sync with design', $catWork, $subMeetings, []);
        $assign('Exercise', $catHealth, $subExercise, [$tagFocus]);
        $assign('Dinner prep', $catPersonal, $subChores, []);
        $assign('Deploy staging', $catWork, null, [$tagUrgent]);
        $assign('Weekly planning', $catWork, $subDeepWork, [$tagThisWeek]);
        $assign('Client launch', $catWork, null, [$tagUrgent]);
    }

    if ($hasTaskBlocks) {
        $blockCols = array_column($pdo->query('PRAGMA table_info(task_blocks)')->fetchAll(PDO::FETCH_ASSOC), 'name');
        $hasBlockIcon = in_array('icon', $blockCols, true);
        if ($hasBlockIcon) {
            $pdo->prepare('INSERT INTO task_blocks (name, color, icon) VALUES (?, ?, ?)')->execute(['Deep work', '#2962ff', 'brain']);
            $blockDeep = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO task_blocks (name, color, icon) VALUES (?, ?, ?)')->execute(['Meetings', '#ff9100', 'users']);
            $blockMeetings = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO task_blocks (name, color, icon) VALUES (?, ?, ?)')->execute(['Personal', '#7c4dff', 'home']);
        } else {
            $pdo->prepare('INSERT INTO task_blocks (name, color) VALUES (?, ?)')->execute(['Deep work', '#2962ff']);
            $blockDeep = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO task_blocks (name, color) VALUES (?, ?)')->execute(['Meetings', '#ff9100']);
            $blockMeetings = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO task_blocks (name, color) VALUES (?, ?)')->execute(['Personal', '#7c4dff']);
        }
        $blockPersonal = (int) $pdo->lastInsertId();

        if ($hasDefaultBlock && $blockDeep) {
            foreach (['Project Alpha – design', 'Project Alpha – implement', 'Weekly planning'] as $title) {
                $tid = $idByTitle[$title] ?? null;
                if ($tid) {
                    $pdo->prepare('UPDATE tasks SET default_block_id = ? WHERE id = ?')->execute([$blockDeep, $tid]);
                }
            }
            $meetTid = $idByTitle['Call with team'] ?? null;
            if ($meetTid && $blockMeetings) {
                $pdo->prepare('UPDATE tasks SET default_block_id = ? WHERE id = ?')->execute([$blockMeetings, $meetTid]);
            }
        }

        if ($hasScheduleBlocks) {
            $schedBlockIns = $pdo->prepare('INSERT INTO schedule_blocks (day_record_id, block_id, start_time, end_time) VALUES (?, ?, ?, ?)');
            $schedBlockIns->execute([$todayId, $blockDeep, '09:00', '12:00']);
            $schedBlockIns->execute([$todayId, $blockMeetings, '13:00', '17:00']);
            $schedBlockIns->execute([$yesterdayId, $blockDeep, '10:00', '12:00']);
            if ($tomorrowId && $blockPersonal) {
                $schedBlockIns->execute([$tomorrowId, $blockPersonal, '18:00', '20:00']);
            }
            for ($i = 0; $i < 7; $i++) {
                $weekDate = date('Y-m-d', strtotime($weekSunday . " +$i days"));
                if (!isset($dayIds[$weekDate]) || $weekDate === $today) {
                    continue;
                }
                $blockId = ($i % 2 === 0) ? $blockDeep : $blockMeetings;
                if ($blockId) {
                    $schedBlockIns->execute([$dayIds[$weekDate], $blockId, '09:00', '12:00']);
                }
            }
        }
    }

    if ($hasFavoriteFolder && $hasIsCommon) {
        $pdo->prepare('INSERT INTO favorite_folder (name, sort_order) VALUES (?, ?)')->execute(['Templates', 0]);
        $folderId = (int) $pdo->lastInsertId();
        $kickoffId = $idByTitle['Client kickoff checklist'] ?? null;
        if ($kickoffId) {
            $pdo->prepare('UPDATE tasks SET favorite_folder_id = ? WHERE id = ?')->execute([$folderId, $kickoffId]);
        }
    }

    // iCal subscriptions left unseeded; a dedicated demo feed URL could be added here later if desired.

    $demoAiPath = $dataDir . '/daytracker_demo_ai.sqlite';
    if (is_file($demoAiPath)) {
        @unlink($demoAiPath);
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
