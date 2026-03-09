<?php
/**
 * ChatGPT proxy: accepts message + taskContext, calls OpenAI, returns { advice, suggestedTasks }.
 */
require_once __DIR__ . '/common.php';

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    jsonError('Method not allowed', 405);
    exit;
}

$config = getConfig();
$apiKey = $config['openai_api_key'] ?? getenv('OPENAI_API_KEY') ?: '';

$input = readJsonInput();
if ($input && !empty($input['apiKey'])) {
    $apiKey = trim($input['apiKey']);
}

if ($apiKey === '') {
    jsonError('OpenAI API key not configured. Set openai_api_key in config.php or pass apiKey in request.', 400);
    exit;
}

$message = isset($input['message']) ? trim((string) $input['message']) : '';
$taskContext = $input['taskContext'] ?? [];

$systemPrompt = <<<'PROMPT'
You are a helpful assistant for daily task prioritization. The user will send you a message about their priorities and a structured context: accomplished tasks today, their current task list (with priority, recurring, links, subtasks), and unaccomplished items for today.

Respond with a JSON object only, no other text. Use this exact structure:
{
  "advice": "One or two short paragraphs of concrete advice on what to focus on and how to order their tasks.",
  "suggestedTasks": [
    { "title": "Task name", "priority": "commitment" or "high" or "medium" or "low", "suggestedSlot": "optional time like 09:00" },
    ...
  ]
}

- advice: max 2 paragraphs, actionable.
- suggestedTasks: 0 to 8 tasks the user might add. Include "priority" when relevant. suggestedSlot is optional.
If you wrap the JSON in a markdown code block, use ```json ... ``` so it can be parsed.
PROMPT;

$userContent = $message . "\n\nContext:\n" . json_encode($taskContext, JSON_PRETTY_PRINT);

$body = [
    'model' => 'gpt-4o-mini',
    'messages' => [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => $userContent],
    ],
    'temperature' => 0.3,
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
curl_close($ch);

if ($response === false) {
    jsonError('Request to OpenAI failed', 502);
    exit;
}

$data = json_decode($response, true);
if (!$data || !isset($data['choices'][0]['message']['content'])) {
    $err = isset($data['error']['message']) ? $data['error']['message'] : 'Invalid response from OpenAI';
    jsonError($err, $code >= 400 ? $code : 502);
    exit;
}

$content = trim($data['choices'][0]['message']['content']);
if (preg_match('/```(?:json)?\s*([\s\S]*?)```/', $content, $m)) {
    $content = trim($m[1]);
}
$parsed = json_decode($content, true);
if (!is_array($parsed)) {
    jsonError('Could not parse OpenAI response as JSON', 502);
    exit;
}

$advice = isset($parsed['advice']) ? (string) $parsed['advice'] : '';
$suggestedTasks = isset($parsed['suggestedTasks']) && is_array($parsed['suggestedTasks']) ? $parsed['suggestedTasks'] : [];

jsonResponse(['advice' => $advice, 'suggestedTasks' => $suggestedTasks]);
