<?php
/**
 * Session-based auth. Master DB holds users; user DB path is per-username (or email local part for SSO).
 */
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/logger.php';

/** Default session length when users.session_lifetime_days is NULL. */
const SESSION_LIFETIME_DEFAULT_DAYS = 30;

/** Max cookie / gc lifetime for indefinite sessions (10 years). */
const SESSION_COOKIE_MAX_SECONDS = 10 * 365 * 24 * 60 * 60;

if (session_status() === PHP_SESSION_NONE) {
    $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    $cookieLifetime = 400 * 24 * 60 * 60; // upper bound; per-user expiry enforced server-side

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

/** @return int 0 = indefinite, 1–365 = days */
function normalizeSessionLifetimeDays(?int $days): int {
    if ($days === null) {
        return SESSION_LIFETIME_DEFAULT_DAYS;
    }
    if ($days === 0) {
        return 0;
    }
    return max(1, min(365, $days));
}

function getUserSessionLifetimeDays(int $userId): int {
    $master = getMasterPdo();
    $stmt = $master->prepare('SELECT session_lifetime_days FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || $row['session_lifetime_days'] === null) {
        return SESSION_LIFETIME_DEFAULT_DAYS;
    }
    return normalizeSessionLifetimeDays((int) $row['session_lifetime_days']);
}

function refreshSessionCookieForLifetime(int $days): void {
    $params = session_get_cookie_params();
    $lifetimeSeconds = $days === 0 ? SESSION_COOKIE_MAX_SECONDS : ($days * 86400);
    $cookieParams = [
        'expires' => time() + $lifetimeSeconds,
        'path' => $params['path'] ?: '/',
        'domain' => $params['domain'] ?? '',
        'secure' => (bool) ($params['secure'] ?? false),
        'httponly' => (bool) ($params['httponly'] ?? true),
    ];
    if (PHP_VERSION_ID >= 70300) {
        $cookieParams['samesite'] = $params['samesite'] ?? 'Lax';
        setcookie(session_name(), session_id(), $cookieParams);
    } else {
        setcookie(
            session_name(),
            session_id(),
            $cookieParams['expires'],
            $cookieParams['path'],
            $cookieParams['domain'],
            $cookieParams['secure'],
            $cookieParams['httponly']
        );
    }
}

function applySessionExpiryForUser(int $userId): void {
    $days = getUserSessionLifetimeDays($userId);
    if ($days === 0) {
        unset($_SESSION['daytracker_expires_at']);
    } else {
        $_SESSION['daytracker_expires_at'] = time() + ($days * 86400);
    }
    $_SESSION['daytracker_expiry_init'] = true;
    refreshSessionCookieForLifetime($days);
}

function ensureSessionExpiryInitialized(): void {
    if (!isset($_SESSION['daytracker_user']) || !empty($_SESSION['daytracker_expiry_init'])) {
        return;
    }
    applySessionExpiryForUser((int) $_SESSION['daytracker_user']['id']);
}

function isSessionExpired(): bool {
    if (!isset($_SESSION['daytracker_expires_at'])) {
        return false;
    }
    return time() > (int) $_SESSION['daytracker_expires_at'];
}

function getCurrentUser(): ?array {
    if (!isset($_SESSION['daytracker_user'])) {
        return null;
    }
    ensureSessionExpiryInitialized();
    if (isSessionExpired()) {
        logout();
        return null;
    }
    return $_SESSION['daytracker_user'];
}

function requireAuth(): void {
    $hadUser = isset($_SESSION['daytracker_user']);
    ensureSessionExpiryInitialized();
    if ($hadUser && isSessionExpired()) {
        logMessage('INFO', 'auth requireAuth failed', ['reason' => 'session_expired', 'uri' => $_SERVER['REQUEST_URI'] ?? '']);
        logout();
        jsonResponse(['error' => 'Session expired', 'code' => 'session_expired'], 401);
        exit;
    }
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
    unset($_SESSION['daytracker_expiry_init']);
    applySessionExpiryForUser((int) $user['id']);
}

function logout(): void {
    $_SESSION['daytracker_user'] = null;
    unset($_SESSION['daytracker_user'], $_SESSION['daytracker_expires_at'], $_SESSION['daytracker_expiry_init']);
}

function safeUsernameFromEmail(string $email): string {
    $local = explode('@', $email, 2)[0];
    $local = preg_replace('/[^a-zA-Z0-9_-]/', '_', $local);
    return $local ?: 'user';
}

function sessionExpiresAtIso(): ?string {
    if (!isset($_SESSION['daytracker_expires_at'])) {
        return null;
    }
    return gmdate('c', (int) $_SESSION['daytracker_expires_at']);
}
