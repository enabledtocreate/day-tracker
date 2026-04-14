<?php
/**
 * Fatal error logging for API-style PHP entry points that may not use api/common.php.
 * Does not replace exception handlers — register those per script as needed.
 */
require_once __DIR__ . '/logger.php';

/**
 * Log E_ERROR / parse / core errors that do not trigger the exception handler.
 * Safe to call multiple times (registers shutdown handler once).
 */
function daytracker_register_fatal_shutdown_logger(): void
{
    static $registered = false;
    if ($registered) {
        return;
    }
    $registered = true;

    register_shutdown_function(static function (): void {
        if (getenv('DAYTRACKER_TEST') === '1') {
            return;
        }
        $err = error_get_last();
        if ($err === null) {
            return;
        }
        $fatalTypes = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR];
        if (!in_array($err['type'], $fatalTypes, true)) {
            return;
        }
        logError('ERROR', 'PHP fatal (shutdown): ' . $err['message'], [
            'file' => $err['file'],
            'line' => $err['line'],
            'type' => $err['type'],
        ]);
    });
}
