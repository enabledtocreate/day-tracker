<?php
/**
 * AI assistant: POST JSON §5.2 assistant envelope (OpenAI proxy).
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/ai_server_context.php';
require_once dirname(__DIR__) . '/lib/ai_thread_history.php';

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

$config = getConfig();
$apiKey = $config['openai_api_key'] ?? getenv('OPENAI_API_KEY') ?: '';

$input = readJsonInput();
if ($input && !empty($input['apiKey'])) {
    $apiKey = trim((string) $input['apiKey']);
}

if ($apiKey === '') {
    jsonError('OpenAI API key not configured. Set openai_api_key in config.php or pass apiKey in request.', 400);
    exit;
}

$message = isset($input['message']) ? trim((string) $input['message']) : '';
if ($message === '') {
    jsonError('message required');
    exit;
}

$viewDate = isset($input['viewDate']) ? trim((string) $input['viewDate']) : '';
$contextOptions = isset($input['contextOptions']) && is_array($input['contextOptions']) ? $input['contextOptions'] : [];
$taskContext = isset($input['taskContext']) && is_array($input['taskContext']) ? $input['taskContext'] : [];
$contextFragments = isset($input['contextFragments']) && is_array($input['contextFragments']) ? $input['contextFragments'] : [];
$useServerContext = !empty($input['useServerContext']);
$threadId = isset($input['threadId']) ? (int) $input['threadId'] : 0;
$threadHistoryMax = isset($input['threadHistoryMax']) ? (int) $input['threadHistoryMax'] : 24;
$threadHistoryMax = max(0, min(40, $threadHistoryMax));

$effectiveTaskContext = $taskContext;
if ($useServerContext && $viewDate !== '') {
    try {
        $pdoCtx = getPdo();
        $serverPack = ai_build_server_task_context($pdoCtx, $viewDate, $contextOptions);
        $effectiveTaskContext = $taskContext;
        foreach ($serverPack as $k => $v) {
            $effectiveTaskContext[$k] = $v;
        }
    } catch (Throwable $e) {
        logError('WARNING', 'chat.php useServerContext build failed: ' . $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
        ]);
    }
}

/**
 * Normalize model output toward §5.2.
 *
 * @param array<string,mixed> $p
 * @return array<string,mixed>
 */
function ai_normalize_assistant_json(array $p): array
{
    if (!isset($p['schemaVersion'])) {
        $p['schemaVersion'] = 1;
    }
    if (isset($p['advice']) && is_string($p['advice'])) {
        $p['advice'] = ['summary' => $p['advice'], 'bullets' => []];
    }
    if (!isset($p['advice']) || !is_array($p['advice'])) {
        $p['advice'] = ['summary' => '', 'bullets' => []];
    }
    if (!isset($p['advice']['summary'])) {
        $p['advice']['summary'] = '';
    }
    if (!isset($p['advice']['bullets']) || !is_array($p['advice']['bullets'])) {
        $p['advice']['bullets'] = [];
    }
    $kinds = ['plan', 'need_context', 'mixed'];
    if (!isset($p['kind']) || !in_array($p['kind'], $kinds, true)) {
        $p['kind'] = 'plan';
    }
    if (!isset($p['dataRequests']) || !is_array($p['dataRequests'])) {
        $p['dataRequests'] = [];
    }
    if (!isset($p['proposals']) || !is_array($p['proposals'])) {
        $p['proposals'] = [];
    }
    foreach ($p['proposals'] as &$g) {
        if (!is_array($g)) {
            continue;
        }
        if (!isset($g['id'])) {
            $g['id'] = '';
        }
        if (!isset($g['groupTitle'])) {
            $g['groupTitle'] = '';
        }
        if (!isset($g['groupSummary'])) {
            $g['groupSummary'] = '';
        }
        if (!isset($g['horizon'])) {
            $g['horizon'] = 'unspecified';
        }
        if (!isset($g['prioritization'])) {
            $g['prioritization'] = 'user_specified';
        }
        if (!isset($g['cadence']) || !is_array($g['cadence'])) {
            $g['cadence'] = ['frequency' => 'once', 'dayOfWeek' => null, 'timeOfDay' => null, 'notes' => ''];
        }
        if (!isset($g['tasks']) || !is_array($g['tasks'])) {
            $g['tasks'] = [];
        }
        if (!isset($g['questionsForUser']) || !is_array($g['questionsForUser'])) {
            $g['questionsForUser'] = [];
        }
        foreach ($g['tasks'] as &$t) {
            if (!is_array($t)) {
                continue;
            }
            if (!isset($t['suggestedSlot']) || !is_array($t['suggestedSlot'])) {
                $t['suggestedSlot'] = ['date' => null, 'start' => null, 'end' => null];
            }
            if (!isset($t['groupWithTaskId'])) {
                $t['groupWithTaskId'] = null;
            }
            if (!isset($t['tagIds']) || !is_array($t['tagIds'])) {
                $t['tagIds'] = [];
            }
            if (!isset($t['tagTempIds']) || !is_array($t['tagTempIds'])) {
                $t['tagTempIds'] = [];
            } else {
                $tagTempClean = [];
                foreach ($t['tagTempIds'] as $x) {
                    $s = trim((string) $x);
                    if ($s !== '') {
                        $tagTempClean[] = $s;
                    }
                }
                $t['tagTempIds'] = $tagTempClean;
            }
            if (!isset($t['newTagSuggestions']) || !is_array($t['newTagSuggestions'])) {
                $t['newTagSuggestions'] = [];
            }
            if (!isset($t['categoryId'])) {
                $t['categoryId'] = null;
            }
            if (!isset($t['subcategoryId'])) {
                $t['subcategoryId'] = null;
            }
            if (!isset($t['categoryTempId']) || $t['categoryTempId'] === '' || $t['categoryTempId'] === null) {
                $t['categoryTempId'] = null;
            } else {
                $t['categoryTempId'] = trim((string) $t['categoryTempId']);
            }
            if (!isset($t['subcategoryTempId']) || $t['subcategoryTempId'] === '' || $t['subcategoryTempId'] === null) {
                $t['subcategoryTempId'] = null;
            } else {
                $t['subcategoryTempId'] = trim((string) $t['subcategoryTempId']);
            }
            if (!isset($t['linkAttachments']) || !is_array($t['linkAttachments'])) {
                $t['linkAttachments'] = [];
            }
        }
        unset($t);
    }
    unset($g);
    $maxOrgCreates = 25;
    if (!isset($p['proposedOrgCreates']) || !is_array($p['proposedOrgCreates'])) {
        $p['proposedOrgCreates'] = [];
    } else {
        $p['proposedOrgCreates'] = array_values(array_slice($p['proposedOrgCreates'], 0, $maxOrgCreates));
        $p['proposedOrgCreates'] = array_values(array_filter($p['proposedOrgCreates'], 'is_array'));
        foreach ($p['proposedOrgCreates'] as &$oc) {
            $oc['tempId'] = isset($oc['tempId']) ? trim((string) $oc['tempId']) : '';
            $okinds = ['category', 'subcategory', 'tag'];
            $oc['kind'] = isset($oc['kind']) && in_array($oc['kind'], $okinds, true) ? $oc['kind'] : 'tag';
            $oc['name'] = isset($oc['name']) ? trim((string) $oc['name']) : '';
            if (isset($oc['color']) && $oc['color'] !== null && $oc['color'] !== '') {
                $oc['color'] = trim((string) $oc['color']);
            } else {
                $oc['color'] = null;
            }
            if (!isset($oc['parentCategoryId']) || $oc['parentCategoryId'] === '' || $oc['parentCategoryId'] === null) {
                $oc['parentCategoryId'] = null;
            } else {
                $oc['parentCategoryId'] = (int) $oc['parentCategoryId'];
            }
            if (!isset($oc['parentCategoryTempId']) || $oc['parentCategoryTempId'] === '' || $oc['parentCategoryTempId'] === null) {
                $oc['parentCategoryTempId'] = null;
            } else {
                $oc['parentCategoryTempId'] = trim((string) $oc['parentCategoryTempId']);
            }
        }
        unset($oc);
    }
    if (!isset($p['clientHints']) || !is_array($p['clientHints'])) {
        $p['clientHints'] = ['includeIcalEvents' => false, 'icalRangeDays' => 7];
    }
    return $p;
}

$systemPrompt = <<<'PROMPT'
You are a planning assistant for Day Tracker (tasks, schedule slots, priorities). Reply with a single JSON object only (no markdown prose outside JSON).

Required shape:
{
  "schemaVersion": 1,
  "kind": "plan" | "need_context" | "mixed",
  "advice": {
    "summary": "short actionable text, max ~800 chars",
    "bullets": ["optional short lines"]
  },
  "dataRequests": [
    {
      "id": "unique string",
      "queryId": "one of: tasks.list | slots.range | accomplished.range | org.catalog | settings.schedule | ical.events.range",
      "params": { },
      "userFacingReason": "why you need this in plain language"
    }
  ],
  "proposedOrgCreates": [
    {
      "tempId": "cat_work",
      "kind": "category",
      "name": "Work",
      "color": "#336699 or null",
      "parentCategoryId": null,
      "parentCategoryTempId": null
    }
  ],
  "proposals": [
    {
      "id": "pg_1",
      "groupTitle": "string",
      "groupSummary": "string",
      "horizon": "hourly|daily|weekly|monthly|unspecified",
      "prioritization": "deadline_first|commitment_first|energy_match|user_specified",
      "cadence": {
        "frequency": "once|daily|weekly|weekdays|monthly|custom",
        "dayOfWeek": "monday|null",
        "timeOfDay": "HH:mm|null",
        "notes": "optional"
      },
      "tasks": [
        {
          "title": "string",
          "priority": "commitment|high|medium|low",
          "suggestedSlot": { "date": "YYYY-MM-DD or null", "start": "HH:mm or null", "end": "HH:mm or null" },
          "groupWithTaskId": null,
          "tagIds": [],
          "tagTempIds": [],
          "newTagSuggestions": [],
          "categoryId": null,
          "subcategoryId": null,
          "categoryTempId": null,
          "subcategoryTempId": null,
          "linkAttachments": [ { "label": "string", "url": "https://..." } ],
          "listItems": { "listStyle": "bullet|checkbox", "items": ["line"] }
        }
      ],
      "questionsForUser": [ { "text": "string", "blocksProposalApply": true } ]
    }
  ],
  "clientHints": { "includeIcalEvents": false, "icalRangeDays": 7 }
}

Rules:
- If baseline context is enough, use "kind":"plan", dataRequests:[], fill proposals.
- If you need more data, set "kind":"need_context" or "mixed" and non-empty dataRequests with valid queryId only.
- For slots.range / accomplished.range / ical.events.range, params MUST include "from" and "to" as YYYY-MM-DD.
- For tasks.list, optional params: "with_org": true.
- proposals tasks may omit listItems or use empty items array.
- Keep proposals modest (e.g. under 20 tasks total across all groups).
- Client taskContext includes "organization" (categories, subcategories, tags with ids). Prefer reusing those ids in categoryId, subcategoryId, tagIds. Use proposedOrgCreates + categoryTempId/subcategoryTempId/tagTempIds only when the user needs genuinely new labels; dedupe by name in your head against taskContext.organization before inventing.
- Subcategory rows in proposedOrgCreates must set parentCategoryId (existing) or parentCategoryTempId (must match a category tempId in the same proposedOrgCreates list).
- newTagSuggestions: plain names; Apply will find-or-create tags. Prefer tagTempIds + proposedOrgCreates when you need explicit control.
PROMPT;

$userParts = [];
$userParts[] = $message;
if ($viewDate !== '') {
    $userParts[] = 'User schedule focus date (viewDate): ' . $viewDate;
}
if (count($contextOptions) > 0) {
    $userParts[] = 'contextOptions JSON: ' . json_encode($contextOptions, JSON_UNESCAPED_UNICODE);
}
if (count($taskContext) > 0) {
    $userParts[] = 'Client taskContext JSON: ' . json_encode($taskContext, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}
if (count($contextFragments) > 0) {
    $userParts[] = 'Resolved server contextFragments JSON: ' . json_encode($contextFragments, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}
$userContent = implode("\n\n", $userParts);

$historyMessages = [];
if ($threadId > 0 && $threadHistoryMax > 0) {
    try {
        $aiPdo = getAiPdo();
        $historyMessages = ai_thread_openai_history($aiPdo, $threadId, $message, $threadHistoryMax);
    } catch (Throwable $e) {
        logError('WARNING', 'chat.php thread history load failed: ' . $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
        ]);
    }
}

$openaiMessages = [['role' => 'system', 'content' => $systemPrompt]];
foreach ($historyMessages as $hm) {
    $openaiMessages[] = $hm;
}
$openaiMessages[] = ['role' => 'user', 'content' => $userContent];

$body = [
    'model' => 'gpt-4o-mini',
    'messages' => $openaiMessages,
    'temperature' => 0.3,
    'response_format' => ['type' => 'json_object'],
];

$ch = curl_init('https://api.openai.com/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($body),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey,
    ],
    CURLOPT_RETURNTRANSFER => true,
]);

$response = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($response === false) {
    logError('ERROR', 'OpenAI curl request failed', ['curl_error' => $curlErr, 'http_code' => $code]);
    jsonError('Request to OpenAI failed', 502);
    exit;
}

$data = json_decode($response, true);
if (!$data || !isset($data['choices'][0]['message']['content'])) {
    $err = isset($data['error']['message']) ? $data['error']['message'] : 'Invalid response from OpenAI';
    $snippet = is_string($response) ? substr($response, 0, 500) : '';
    logError('WARNING', 'OpenAI response unexpected shape', [
        'http_code' => $code,
        'error_detail' => $err,
        'body_snippet' => $snippet,
    ]);
    jsonError($err, $code >= 400 ? $code : 502);
    exit;
}

$content = trim($data['choices'][0]['message']['content']);
if (preg_match('/```(?:json)?\s*([\s\S]*?)```/', $content, $m)) {
    $content = trim($m[1]);
}
$parsed = json_decode($content, true);
if (!is_array($parsed)) {
    logError('WARNING', 'OpenAI content not valid JSON', ['content_snippet' => substr($content, 0, 400)]);
    jsonError('Could not parse OpenAI response as JSON', 502);
    exit;
}

$out = ai_normalize_assistant_json($parsed);
jsonResponse($out);
