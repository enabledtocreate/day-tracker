<?php
/**
 * POST: resolve AI dataRequests to contextFragments (plan §5.3, §6).
 */
require_once dirname(__DIR__) . '/common.php';
require_once dirname(__DIR__, 2) . '/lib/ai_context_handlers.php';
require_once dirname(__DIR__, 2) . '/lib/db.php';

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    jsonError('Method not allowed', 405);
    exit;
}

$master = getMasterPdo();
$st = $master->query("SELECT value FROM app_settings WHERE key = 'ai_enabled'");
$row = $st ? $st->fetch(PDO::FETCH_ASSOC) : null;
$aiOn = !$row || ($row['value'] ?? '1') !== '0';
if (!$aiOn) {
    jsonError('AI is disabled', 403);
    exit;
}

$input = readJsonInput();
if (!$input || empty($input['dataRequests']) || !is_array($input['dataRequests'])) {
    jsonError('dataRequests array required');
    exit;
}

$requests = $input['dataRequests'];
if (count($requests) > 20) {
    jsonError('Too many dataRequests (max 20)');
    exit;
}

$pdo = getPdoSafe();
$allowedIds = [
    'tasks.list',
    'slots.range',
    'accomplished.range',
    'org.catalog',
    'settings.schedule',
    'ical.events.range',
];

$rowBudgetTotal = 500;
$rowBudgetUsed = 0;
$fragments = [];
$truncated = false;

foreach ($requests as $req) {
    if (!is_array($req)) {
        continue;
    }
    $id = isset($req['id']) ? trim((string) $req['id']) : '';
    $queryId = isset($req['queryId']) ? trim((string) $req['queryId']) : '';
    $params = isset($req['params']) && is_array($req['params']) ? $req['params'] : [];
    if ($id === '' || $queryId === '' || !in_array($queryId, $allowedIds, true)) {
        jsonError('Invalid dataRequest id or queryId');
        exit;
    }
    $remaining = max(0, $rowBudgetTotal - $rowBudgetUsed);
    if ($remaining < 1) {
        $truncated = true;
        break;
    }
    try {
        [$data, $estimate] = aiContextResolveQuery($pdo, $queryId, $params, $remaining);
    } catch (InvalidArgumentException $e) {
        logError('WARNING', 'ai context_resolve: ' . $e->getMessage(), [
            'queryId' => $queryId,
            'dataRequestId' => $id,
        ]);
        jsonError($e->getMessage());
        exit;
    }
    $rowBudgetUsed += min($estimate, $remaining);
    if ($rowBudgetUsed > $rowBudgetTotal) {
        $truncated = true;
    }
    $fragments[] = [
        'dataRequestId' => $id,
        'queryId' => $queryId,
        'data' => $data,
    ];
}

jsonResponse(['contextFragments' => $fragments, 'truncated' => $truncated]);
