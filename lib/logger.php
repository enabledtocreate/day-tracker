<?php
/**
 * Application logging: requests, iCal fetches, errors. Writes to data/daytracker.log.
 * Ensures data directory exists before writing. Safe to call from any entry point.
 */

function getLogDir(): ?string {
    try {
        if (!function_exists('getDataDir')) {
            require_once __DIR__ . '/db.php';
        }
        $dir = getDataDir();
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return is_dir($dir) ? $dir : null;
    } catch (Throwable $e) {
        return null;
    }
}

function getLogPath(): ?string {
    $dir = getLogDir();
    return $dir === null ? null : $dir . DIRECTORY_SEPARATOR . 'daytracker.log';
}

/** @deprecated Use getLogPath(). Kept for compatibility. */
function getErrorLogPath(): ?string {
    return getLogPath();
}

/**
 * Append one line to the app log. Format: ISO timestamp, level, message, optional JSON context.
 */
function logMessage(string $level, string $message, array $context = []): void {
    if (getenv('DAYTRACKER_TEST') === '1') {
        return;
    }
    $path = getLogPath();
    if ($path === null) return;
    $ts = gmdate('Y-m-d\TH:i:s\Z');
    $line = $ts . ' [' . $level . '] ' . str_replace(["\r", "\n"], ' ', $message);
    if ($context !== []) {
        $line .= ' ' . json_encode($context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    $line .= "\n";
    @file_put_contents($path, $line, FILE_APPEND | LOCK_EX);
}

/**
 * Log an incoming API request (method, URI, user id if any).
 */
function logRequest(string $method, string $uri, ?int $userId = null, ?int $status = null): void {
    $ctx = ['uri' => $uri];
    if ($userId !== null) $ctx['user_id'] = $userId;
    if ($status !== null) $ctx['status'] = $status;
    logMessage('REQUEST', $method . ' ' . $uri, $ctx);
}

/**
 * Log the start of an iCal fetch (subscription id, URL, timeout).
 */
function logIcalFetchStart(int $subscriptionId, string $url, int $timeoutSec): void {
    logMessage('INFO', 'iCal fetch start', [
        'subscription_id' => $subscriptionId,
        'url' => $url,
        'timeout_sec' => $timeoutSec,
    ]);
}

/**
 * Log successful iCal fetch (bytes read, duration ms).
 */
function logIcalFetchSuccess(int $subscriptionId, int $bytesRead, float $durationMs): void {
    logMessage('INFO', 'iCal fetch success', [
        'subscription_id' => $subscriptionId,
        'bytes_read' => $bytesRead,
        'duration_ms' => round($durationMs, 2),
    ]);
}

/**
 * Log failed iCal fetch (reason).
 */
function logIcalFetchFailure(int $subscriptionId, string $reason, ?string $url = null): void {
    $ctx = ['subscription_id' => $subscriptionId, 'reason' => $reason];
    if ($url !== null) $ctx['url'] = $url;
    logMessage('WARNING', 'iCal fetch failure', $ctx);
}

/** Alias for logMessage for backward compatibility. */
function logError(string $level, string $message, array $context = []): void {
    logMessage($level, $message, $context);
}

/**
 * Read last N lines from the app log (tail). Returns array of lines, newest last.
 */
function readErrorLogTail(int $maxLines = 1000, int $maxBytes = 512 * 1024): array {
    $path = getLogPath();
    if ($path === null || !is_file($path)) return [];
    $size = @filesize($path);
    if ($size === false || $size === 0) return [];
    $handle = @fopen($path, 'rb');
    if (!$handle) return [];
    $readSize = (int) min($size, $maxBytes);
    fseek($handle, -$readSize, SEEK_END);
    $chunk = fread($handle, $readSize);
    fclose($handle);
    if ($chunk === false) return [];
    $lines = explode("\n", $chunk);
    $lines = array_filter($lines, static function ($l) { return $l !== ''; });
    $lines = array_slice($lines, -$maxLines);
    return array_values($lines);
}
