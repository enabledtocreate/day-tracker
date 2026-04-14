<?php
/**
 * Map persisted AI thread rows to OpenAI chat messages (advice summaries only for assistant turns).
 */
declare(strict_types=1);

/**
 * @return list<array{role: string, content: string}>
 */
function ai_thread_openai_history(PDO $aiPdo, int $threadId, string $currentUserMessage, int $maxMessages): array
{
    $maxMessages = max(0, min(40, $maxMessages));
    if ($threadId < 1 || $maxMessages === 0) {
        return [];
    }

    $chk = $aiPdo->prepare('SELECT 1 FROM ai_threads WHERE id = ?');
    $chk->execute([$threadId]);
    if (!$chk->fetchColumn()) {
        return [];
    }

    $st = $aiPdo->prepare(
        'SELECT role, payload_json FROM ai_messages WHERE thread_id = ? ORDER BY id ASC'
    );
    $st->execute([$threadId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    if ($rows === []) {
        return [];
    }

    $last = $rows[count($rows) - 1];
    if (($last['role'] ?? '') === 'user') {
        $payload = json_decode((string) ($last['payload_json'] ?? '{}'), true);
        $lastText = is_array($payload) && isset($payload['text']) ? trim((string) $payload['text']) : '';
        if ($lastText !== '' && $lastText === trim($currentUserMessage)) {
            array_pop($rows);
        }
    }

    if (count($rows) > $maxMessages) {
        $rows = array_slice($rows, -$maxMessages);
    }

    $out = [];
    foreach ($rows as $row) {
        $role = $row['role'] ?? '';
        if ($role !== 'user' && $role !== 'assistant') {
            continue;
        }
        $payload = json_decode((string) ($row['payload_json'] ?? '{}'), true);
        if (!is_array($payload)) {
            $payload = [];
        }
        if ($role === 'user') {
            $text = isset($payload['text']) ? trim((string) $payload['text']) : '';
            if ($text === '') {
                continue;
            }
            $out[] = ['role' => 'user', 'content' => $text];
            continue;
        }
        $summary = '';
        if (isset($payload['summary']) && is_string($payload['summary'])) {
            $summary = trim($payload['summary']);
        }
        if ($summary === '' && isset($payload['envelope']) && is_array($payload['envelope'])) {
            $env = $payload['envelope'];
            if (isset($env['advice']['summary']) && is_string($env['advice']['summary'])) {
                $summary = trim($env['advice']['summary']);
            }
        }
        if ($summary === '') {
            $summary = '(Assistant reply; no summary stored.)';
        }
        $out[] = [
            'role' => 'assistant',
            'content' => 'Prior assistant reply (summary): ' . $summary,
        ];
    }

    return $out;
}
