<?php
/**
 * OAuth callback: exchange code for tokens, find or create user, set session, redirect to app.
 */
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/sso.php';
require_once dirname(__DIR__) . '/lib/logger.php';

logMessage('INFO', 'auth_callback.php');
$code = isset($_GET['code']) ? trim((string) $_GET['code']) : '';
$provider = ssoDecodeState(isset($_GET['state']) ? (string) $_GET['state'] : null);
if ($provider === null && isset($_GET['provider'])) {
    $p = strtolower(trim((string) $_GET['provider']));
    $provider = ($p === 'google' || $p === 'outlook') ? $p : null;
}
$provider = $provider ?? '';
$base = getBaseUrl();
$appUrl = $base . '/';

if (($provider !== 'google' && $provider !== 'outlook') || $code === '') {
    logMessage('WARNING', 'auth_callback invalid_callback', ['provider' => $provider, 'code_set' => $code !== '']);
    header('Location: ' . $appUrl . '?login_error=invalid_callback');
    exit;
}

logMessage('INFO', 'auth_callback exchange code', ['provider' => $provider]);
$data = ssoExchangeCode($provider, $code);
if (empty($data) || empty($data['sub']) || empty($data['email'])) {
    logMessage('WARNING', 'auth_callback sso_failed', ['provider' => $provider]);
    header('Location: ' . $appUrl . '?login_error=sso_failed');
    exit;
}

$master = getMasterPdo();
$username = safeUsernameFromEmail($data['email']);
$dbName = 'daytracker_' . $username . '.sqlite';
$dataDir = getDataDir();

$stmt = $master->prepare('SELECT master_user_id FROM sso_accounts WHERE provider = ? AND sub = ?');
$stmt->execute([$provider, $data['sub']]);
$existing = $stmt->fetch(PDO::FETCH_ASSOC);

if ($existing) {
    $userId = (int) $existing['master_user_id'];
    $stmt = $master->prepare('SELECT id, username, db_name, is_admin, force_password_reset FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        logMessage('WARNING', 'auth_callback user_not_found', ['user_id' => $userId]);
        header('Location: ' . $appUrl . '?login_error=user_not_found');
        exit;
    }
    logMessage('INFO', 'auth_callback existing user', ['user_id' => $userId]);
    $master->prepare('UPDATE sso_accounts SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE provider = ? AND sub = ?')
        ->execute([
            $data['access_token'] ?? null,
            $data['refresh_token'] ?? null,
            isset($data['expires_in']) ? date('Y-m-d H:i:s', time() + (int) $data['expires_in']) : null,
            $provider,
            $data['sub'],
        ]);
} else {
    logMessage('INFO', 'auth_callback new or link user', ['username' => $username]);
    $stmt = $master->prepare('SELECT id, username, db_name, is_admin, force_password_reset FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        $master->prepare('INSERT INTO users (username, password_hash, db_name, is_admin) VALUES (?, NULL, ?, 0)')
            ->execute([$username, $dbName]);
        $userId = (int) $master->lastInsertId();
        $userPath = $dataDir . '/' . $dbName;
        $userPdo = new PDO('sqlite:' . $userPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        runMigrationsIn($userPdo, dirname(__DIR__) . '/migrations');
        $stmt = $master->prepare('SELECT id, username, db_name, is_admin, force_password_reset FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } else {
        $userId = (int) $row['id'];
    }
    $master->prepare('INSERT INTO sso_accounts (master_user_id, provider, email, sub, access_token, refresh_token, token_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $userId,
            $provider,
            $data['email'],
            $data['sub'],
            $data['access_token'] ?? null,
            $data['refresh_token'] ?? null,
            isset($data['expires_in']) ? date('Y-m-d H:i:s', time() + (int) $data['expires_in']) : null,
        ]);
}

setSessionUser($row);
logMessage('INFO', 'auth_callback ok', ['user_id' => (int) $row['id'], 'provider' => $provider]);
header('Location: ' . $appUrl);
exit;
