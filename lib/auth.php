<?php
/**
 * Session-based auth. Master DB holds users; user DB path is per-username (or email local part for SSO).
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/logger.php';

if (session_status() === PHP_SESSION_NONE) {
    $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    $cookieLifetime = 30 * 24 * 60 * 60; // 30 days

    // Some PHP configs warn if session ini settings are modified after session_start().
    // Apply them before starting the session to keep auth responses JSON-clean.
    if (ini_get('session.gc_maxlifetime') < $cookieLifetime) {
        ini_set('session.gc_maxlifetime', (string) $cookieLifetime);
    }

    session_set_cookie_params([
        'lifetime' => $cookieLifetime,
        'path' => '/',
        'domain' => '',
        'secure' => $isSecure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function getCurrentUser(): ?array {
    return $_SESSION['daytracker_user'] ?? null;
}

function requireAuth(): void {
    $user = getCurrentUser();
    if (!$user) {
        logMessage('INFO', 'auth requireAuth failed', ['reason' => 'no_session', 'uri' => $_SERVER['REQUEST_URI'] ?? '']);
        jsonResponse(['error' => 'Unauthorized', 'code' => 'login_required'], 401);
        exit;
    }
    if (!empty($user['force_password_reset'])) {
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        if (strpos($uri, 'user.php') === false) {
            logMessage('INFO', 'auth requireAuth failed', ['reason' => 'force_password_reset', 'user_id' => $user['id'] ?? null, 'uri' => $uri]);
            jsonResponse(['error' => 'Password reset required', 'code' => 'force_password_reset'], 403);
            exit;
        }
    }
}

function isAdmin(): bool {
    $user = getCurrentUser();
    return $user && !empty($user['is_admin']);
}

function setSessionUser(array $user): void {
    $_SESSION['daytracker_user'] = [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'db_name' => $user['db_name'],
        'is_admin' => !empty($user['is_admin']),
        'force_password_reset' => !empty($user['force_password_reset']),
    ];
}

function logout(): void {
    $_SESSION['daytracker_user'] = null;
    unset($_SESSION['daytracker_user']);
}

function safeUsernameFromEmail(string $email): string {
    $local = explode('@', $email, 2)[0];
    $local = preg_replace('/[^a-zA-Z0-9_-]/', '_', $local);
    return $local ?: 'user';
}
