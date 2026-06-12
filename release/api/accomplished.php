<?php
/**
 * GET accomplished tasks for a day (by day_record_id or date).
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$pdo = getPdoSafe();
$dayId = isset($_GET['day_id']) ? (int) $_GET['day_id'] : 0;
$date = $_GET['date'] ?? '';
$listAll = isset($_GET['list_all']) && $_GET['list_all'] !== '0' && $_GET['list_all'] !== '';
$summaryOrg = isset($_GET['summary_org']) && $_GET['summary_org'] !== '0' && $_GET['summary_org'] !== '';
logMessage('INFO', 'accomplished.php branch', ['day_id' => $dayId, 'date' => $date ?: null, 'list_all' => $listAll, 'summary_org' => $summaryOrg, 'user_id' => $userId]);

/**
 * Duration in hours from scheduled slot times (matches CompletedPanel desktop logic).
 */
function accomplished_slot_hours(?string $start, ?string $end): float
{
    if ($start === null || $start === '' || $end === null || $end === '') {
        return 0.0;
    }
    $parse = static function (string $t): int {
        $parts = array_map('intval', explode(':', $t));
        $h = $parts[0] ?? 0;
        $m = $parts[1] ?? 0;
        return $h * 60 + $m;
    };
    $dm = $parse($end) - $parse($start);
    if ($dm <= 0) {
        return 0.0;
    }
    return round($dm / 60, 2);
}

if ($summaryOrg) {
    $fromDate = isset($_GET['from_date']) ? trim((string) $_GET['from_date']) : '';
    $toDate = isset($_GET['to_date']) ? trim((string) $_GET['to_date']) : '';
    $dateConds = [];
    $dateBind = [];
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromDate)) {
        $dateConds[] = 'd.date >= ?';
        $dateBind[] = $fromDate;
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $toDate)) {
        $dateConds[] = 'd.date <= ?';
        $dateBind[] = $toDate;
    }
    $extraWhere = $dateConds !== [] ? ' AND ' . implode(' AND ', $dateConds) : '';

    $hasOrg = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_category'")->fetchColumn();
    if ($hasOrg) {
        $sql = "
            SELECT d.date, s.task_id, t.title, s.start_time, s.end_time,
                cat.name AS category_name,
                sub.name AS subcategory_name
            FROM scheduled_slots s
            JOIN day_record d ON d.id = s.day_record_id
            JOIN tasks t ON t.id = s.task_id
            LEFT JOIN task_category tcat ON tcat.task_id = t.id
            LEFT JOIN task_categories cat ON cat.id = tcat.category_id
            LEFT JOIN task_subcategory tsub ON tsub.task_id = t.id
            LEFT JOIN task_subcategories sub ON sub.id = tsub.subcategory_id
            WHERE s.completed = 1{$extraWhere}
            ORDER BY d.date ASC, s.id ASC
        ";
    } else {
        $sql = "
            SELECT d.date, s.task_id, t.title, s.start_time, s.end_time,
                NULL AS category_name,
                NULL AS subcategory_name
            FROM scheduled_slots s
            JOIN day_record d ON d.id = s.day_record_id
            JOIN tasks t ON t.id = s.task_id
            WHERE s.completed = 1{$extraWhere}
            ORDER BY d.date ASC, s.id ASC
        ";
    }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($dateBind);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    /** @var array<string, array<string, array{hours: float, tasks: array<int, array{task_id: int, title: string, hours: float}>}>> */
    $acc = [];
    foreach ($rows as $r) {
        $day = $r['date'];
        $hours = accomplished_slot_hours($r['start_time'] ?? null, $r['end_time'] ?? null);
        $cat = isset($r['category_name']) && $r['category_name'] !== '' && $r['category_name'] !== null
            ? (string) $r['category_name']
            : '(Uncategorized)';
        $subRaw = $r['subcategory_name'] ?? null;
        $sub = isset($subRaw) && $subRaw !== '' ? (string) $subRaw : '';
        $bucketKey = $cat . "\0" . $sub;
        if (!isset($acc[$day])) {
            $acc[$day] = [];
        }
        if (!isset($acc[$day][$bucketKey])) {
            $acc[$day][$bucketKey] = ['hours' => 0.0, 'tasks' => []];
        }
        $acc[$day][$bucketKey]['hours'] = round($acc[$day][$bucketKey]['hours'] + $hours, 2);
        $tid = (int) $r['task_id'];
        if (!isset($acc[$day][$bucketKey]['tasks'][$tid])) {
            $acc[$day][$bucketKey]['tasks'][$tid] = [
                'task_id' => $tid,
                'title' => trim((string) ($r['title'] ?? '')),
                'hours' => 0.0,
                // Per-slot start times so we can map the task to whichever
                // schedule block it lives inside (slot start contained in
                // [block_start, block_end)). Stripped from the final payload.
                'slot_starts' => [],
            ];
        }
        $acc[$day][$bucketKey]['tasks'][$tid]['hours'] = round($acc[$day][$bucketKey]['tasks'][$tid]['hours'] + $hours, 2);
        $slotStartRaw = trim((string) ($r['start_time'] ?? ''));
        if ($slotStartRaw !== '') {
            $acc[$day][$bucketKey]['tasks'][$tid]['slot_starts'][] = $slotStartRaw;
        }
    }

    $allTaskIds = [];
    foreach ($acc as $buckets) {
        foreach ($buckets as $data) {
            foreach ($data['tasks'] as $tid => $_) {
                $allTaskIds[(int) $tid] = true;
            }
        }
    }
    $taskIdList = array_keys($allTaskIds);
    $linksByTaskId = [];
    $listItemsByTaskId = [];
    $tagsByTaskId = [];
    if (count($taskIdList) > 0) {
        $ph = implode(',', array_fill(0, count($taskIdList), '?'));
        $linkStmt = $pdo->prepare("SELECT id, task_id, url, description FROM task_links WHERE task_id IN ({$ph}) ORDER BY task_id, id");
        $linkStmt->execute($taskIdList);
        foreach ($linkStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $tid = (int) $row['task_id'];
            if (!isset($linksByTaskId[$tid])) {
                $linksByTaskId[$tid] = [];
            }
            $linksByTaskId[$tid][] = [
                'id' => (int) $row['id'],
                'task_id' => $tid,
                'url' => (string) $row['url'],
                'description' => (string) ($row['description'] ?? ''),
            ];
        }
        $itemStmt = $pdo->prepare("SELECT id, task_id, content, order_index, completed FROM task_list_items WHERE task_id IN ({$ph}) ORDER BY task_id, order_index ASC, id ASC");
        $itemStmt->execute($taskIdList);
        foreach ($itemStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $tid = (int) $row['task_id'];
            if (!isset($listItemsByTaskId[$tid])) {
                $listItemsByTaskId[$tid] = [];
            }
            $listItemsByTaskId[$tid][] = [
                'id' => (int) $row['id'],
                'task_id' => $tid,
                'content' => (string) ($row['content'] ?? ''),
                'order_index' => (int) $row['order_index'],
                'completed' => (int) ($row['completed'] ?? 0),
            ];
        }
        $hasTaskTagJoin = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_tag'")->fetchColumn()
            && (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_tags'")->fetchColumn();
        if ($hasTaskTagJoin) {
            $tagStmt = $pdo->prepare("
                SELECT tt.task_id, tg.id, tg.name, tg.color
                FROM task_tag tt
                INNER JOIN task_tags tg ON tg.id = tt.tag_id
                WHERE tt.task_id IN ({$ph})
                ORDER BY tt.task_id, tg.name COLLATE NOCASE
            ");
            $tagStmt->execute($taskIdList);
            foreach ($tagStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $tid = (int) $row['task_id'];
                if (!isset($tagsByTaskId[$tid])) {
                    $tagsByTaskId[$tid] = [];
                }
                $tagsByTaskId[$tid][] = [
                    'id' => (int) $row['id'],
                    'name' => (string) ($row['name'] ?? ''),
                    'color' => isset($row['color']) && $row['color'] !== '' ? (string) $row['color'] : null,
                ];
            }
        }
    }

    $daysOut = [];
    foreach ($acc as $dayStr => $buckets) {
        $rowOut = [];
        foreach ($buckets as $bucketKey => $data) {
            [$c, $s] = explode("\0", $bucketKey, 2);
            $tasksOut = array_values($data['tasks']);
            usort($tasksOut, static function ($a, $b) {
                $cmp = strcmp((string) $a['title'], (string) $b['title']);
                if ($cmp !== 0) {
                    return $cmp;
                }
                return ((int) $a['task_id']) <=> ((int) $b['task_id']);
            });
            $titlesUnique = [];
            foreach ($tasksOut as $tt) {
                $ti = (string) $tt['title'];
                if ($ti !== '') {
                    $titlesUnique[$ti] = $ti;
                }
            }
            $titles = array_values($titlesUnique);
            sort($titles, SORT_STRING);
            foreach ($tasksOut as &$tRow) {
                $tid = (int) $tRow['task_id'];
                $tRow['links'] = $linksByTaskId[$tid] ?? [];
                $tRow['list_items'] = $listItemsByTaskId[$tid] ?? [];
                $tRow['tags'] = $tagsByTaskId[$tid] ?? [];
            }
            unset($tRow);
            $rowOut[] = [
                'category' => $c,
                'subcategory' => $s !== '' ? $s : null,
                'hours' => $data['hours'],
                'titles' => $titles,
                'tasks' => $tasksOut,
            ];
        }
        usort($rowOut, static function ($a, $b) {
            $ca = strcmp($a['category'], $b['category']);
            if ($ca !== 0) {
                return $ca;
            }
            $sa = $a['subcategory'] ?? '';
            $sb = $b['subcategory'] ?? '';
            return strcmp((string) $sa, (string) $sb);
        });
        $daysOut[] = ['date' => $dayStr, 'rows' => $rowOut];
    }
    usort($daysOut, static function ($a, $b) {
        return strcmp($b['date'], $a['date']);
    });

    /** Per-day rollup of scheduled organization blocks (strip), same date filter as category summary. */
    $blockDaysOut = [];
    /**
     * date -> list of {name, start_min, end_min} for task→block mapping below.
     * Populated alongside the rollup so we don't reissue the query.
     */
    $blocksByDate = [];
    $hasBlockTables = (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schedule_blocks'")->fetchColumn()
        && (bool) $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_blocks'")->fetchColumn();
    if ($hasBlockTables) {
        $sqlBlocks = "
            SELECT d.date, tb.name AS block_name, sb.start_time, sb.end_time
            FROM schedule_blocks sb
            INNER JOIN day_record d ON d.id = sb.day_record_id
            INNER JOIN task_blocks tb ON tb.id = sb.block_id
            WHERE 1=1{$extraWhere}
            ORDER BY d.date ASC, tb.name COLLATE NOCASE, sb.start_time, sb.id
        ";
        $stmtB = $pdo->prepare($sqlBlocks);
        $stmtB->execute($dateBind);
        $blockAcc = [];
        // HH:MM(:SS) → minutes since midnight, or null if unparseable.
        $timeToMin = static function (?string $t): ?int {
            if ($t === null || $t === '') {
                return null;
            }
            $parts = array_map('intval', explode(':', $t));
            $h = $parts[0] ?? 0;
            $m = $parts[1] ?? 0;
            return $h * 60 + $m;
        };
        foreach ($stmtB->fetchAll(PDO::FETCH_ASSOC) as $br) {
            $dayB = (string) $br['date'];
            $nameB = trim((string) ($br['block_name'] ?? ''));
            if ($nameB === '') {
                $nameB = '(Block)';
            }
            $startB = isset($br['start_time']) ? (string) $br['start_time'] : '';
            $endB = isset($br['end_time']) ? (string) $br['end_time'] : '';
            $hB = accomplished_slot_hours($startB !== '' ? $startB : null, $endB !== '' ? $endB : null);
            if (!isset($blockAcc[$dayB])) {
                $blockAcc[$dayB] = [];
            }
            if (!isset($blockAcc[$dayB][$nameB])) {
                $blockAcc[$dayB][$nameB] = 0.0;
            }
            $blockAcc[$dayB][$nameB] = round($blockAcc[$dayB][$nameB] + $hB, 2);

            $bStart = $timeToMin($startB ?: null);
            $bEnd = $timeToMin($endB ?: null);
            if ($bStart !== null && $bEnd !== null && $bEnd > $bStart) {
                if (!isset($blocksByDate[$dayB])) {
                    $blocksByDate[$dayB] = [];
                }
                $blocksByDate[$dayB][] = ['name' => $nameB, 'start_min' => $bStart, 'end_min' => $bEnd];
            }
        }
        foreach ($blockAcc as $dayStrB => $byName) {
            $rowsB = [];
            $totalB = 0.0;
            foreach ($byName as $nm => $hrs) {
                $rowsB[] = ['block_name' => $nm, 'hours' => $hrs];
                $totalB += $hrs;
            }
            usort($rowsB, static function ($a, $b) {
                return strcmp((string) $a['block_name'], (string) $b['block_name']);
            });
            $blockDaysOut[] = [
                'date' => $dayStrB,
                'rows' => $rowsB,
                'total_hours' => round($totalB, 2),
            ];
        }
        usort($blockDaysOut, static function ($a, $b) {
            return strcmp((string) $b['date'], (string) $a['date']);
        });
    }

    /**
     * Decorate every task in the category rollup with `block_names`: the
     * distinct set of schedule-strip blocks whose [start, end) interval
     * contains at least one of that task's completed slot start times on
     * that day. Empty array when the task isn't inside any block. The
     * internal `slot_starts` helper field is stripped before responding.
     */
    $timeToMinFinal = static function (?string $t): ?int {
        if ($t === null || $t === '') {
            return null;
        }
        $parts = array_map('intval', explode(':', $t));
        $h = $parts[0] ?? 0;
        $m = $parts[1] ?? 0;
        return $h * 60 + $m;
    };
    foreach ($daysOut as &$dayOut) {
        $dStr = (string) $dayOut['date'];
        $blocksForDay = $blocksByDate[$dStr] ?? [];
        foreach ($dayOut['rows'] as &$rowOutRef) {
            foreach ($rowOutRef['tasks'] as &$taskRef) {
                $names = [];
                if (!empty($blocksForDay)) {
                    foreach (($taskRef['slot_starts'] ?? []) as $startRaw) {
                        $sm = $timeToMinFinal($startRaw);
                        if ($sm === null) {
                            continue;
                        }
                        foreach ($blocksForDay as $blk) {
                            if ($sm >= $blk['start_min'] && $sm < $blk['end_min']) {
                                $names[$blk['name']] = $blk['name'];
                            }
                        }
                    }
                }
                $taskRef['block_names'] = array_values($names);
                unset($taskRef['slot_starts']);
            }
            unset($taskRef);
        }
        unset($rowOutRef);
    }
    unset($dayOut);

    logMessage('INFO', 'accomplished summary_org ok', ['days' => count($daysOut), 'block_days' => count($blockDaysOut), 'from_date' => $fromDate ?: null, 'to_date' => $toDate ?: null]);
    jsonResponse(['days' => $daysOut, 'block_days' => $blockDaysOut]);
    exit;
}

if ($listAll) {
    $with = isset($_GET['with']) ? trim((string) $_GET['with']) : '';
    $withLinks = $with !== '' && in_array('links', array_map('trim', explode(',', $with)), true);
    $withListItems = $with !== '' && in_array('list_items', array_map('trim', explode(',', $with)), true);

    logMessage('INFO', 'accomplished listAll');
    // One row per completed slot (roots and group members alike); no nested "subtasks" in the response.
    $stmt = $pdo->prepare("
        SELECT s.id, s.day_record_id, s.task_id, t.title, s.start_time, s.end_time AS completed_at, d.date
        FROM scheduled_slots s
        JOIN day_record d ON d.id = s.day_record_id
        JOIN tasks t ON t.id = s.task_id
        WHERE s.completed = 1
        ORDER BY d.date DESC, s.end_time
    ");
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $byDate = [];
    $taskIds = [];
    foreach ($rows as $r) {
        $taskIds[] = (int) $r['task_id'];
        $d = $r['date'];
        unset($r['date']);
        if (!isset($byDate[$d])) {
            $byDate[$d] = [];
        }
        $byDate[$d][] = $r;
    }
    $taskIds = array_values(array_unique($taskIds));
    $out = ['byDate' => $byDate];
    if (($withLinks || $withListItems) && count($taskIds) > 0) {
        if ($withLinks) {
            $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
            $linkStmt = $pdo->prepare("SELECT id, task_id, url, description FROM task_links WHERE task_id IN ({$placeholders}) ORDER BY task_id, id");
            $linkStmt->execute($taskIds);
            $linkRows = $linkStmt->fetchAll(PDO::FETCH_ASSOC);
            $linksByTaskId = [];
            foreach ($linkRows as $row) {
                $tid = (int) $row['task_id'];
                if (!isset($linksByTaskId[$tid])) $linksByTaskId[$tid] = [];
                $linksByTaskId[$tid][] = $row;
            }
            $out['linksByTaskId'] = $linksByTaskId;
        }
        if ($withListItems) {
            $placeholders = implode(',', array_fill(0, count($taskIds), '?'));
            $itemStmt = $pdo->prepare("SELECT id, task_id, content, order_index, completed FROM task_list_items WHERE task_id IN ({$placeholders}) ORDER BY task_id, order_index ASC, id ASC");
            $itemStmt->execute($taskIds);
            $itemRows = $itemStmt->fetchAll(PDO::FETCH_ASSOC);
            $listItemsByTaskId = [];
            foreach ($itemRows as $row) {
                $tid = (int) $row['task_id'];
                if (!isset($listItemsByTaskId[$tid])) $listItemsByTaskId[$tid] = [];
                $listItemsByTaskId[$tid][] = $row;
            }
            $out['listItemsByTaskId'] = $listItemsByTaskId;
        }
    }
    logMessage('INFO', 'accomplished listAll ok', ['dates' => count($byDate), 'with' => $with]);
    jsonResponse($out);
    exit;
}

if ($dayId > 0) {
    logMessage('INFO', 'accomplished by day_id', ['day_id' => $dayId]);
    $stmt = $pdo->prepare("SELECT s.id, s.day_record_id, s.task_id, t.title, s.end_time AS completed_at FROM scheduled_slots s JOIN tasks t ON t.id = s.task_id WHERE s.day_record_id = ? AND s.completed = 1 AND t.parent_id IS NULL ORDER BY s.end_time");
    $stmt->execute([$dayId]);
} elseif (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    logMessage('INFO', 'accomplished by date', ['date' => $date]);
    $stmt = $pdo->prepare("SELECT s.id, s.day_record_id, s.task_id, t.title, s.end_time AS completed_at FROM scheduled_slots s JOIN day_record d ON d.id = s.day_record_id JOIN tasks t ON t.id = s.task_id WHERE d.date = ? AND s.completed = 1 AND t.parent_id IS NULL ORDER BY s.end_time");
    $stmt->execute([$date]);
} else {
    logMessage('INFO', 'accomplished no day_id or date');
    jsonResponse(['accomplished' => []]);
    exit;
}

$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
logMessage('INFO', 'accomplished ok', ['count' => count($rows)]);
jsonResponse(['accomplished' => $rows]);
