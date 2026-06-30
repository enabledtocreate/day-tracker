<?php
/**
 * OAuth callback: exchange code for tokens, find or create user, set session, redirect to app.
 */
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/sso.php';
require_once dirname(__DIR__) . '/lib/sso_transfer.php';
require_once dirname(__DIR__) . '/lib/logger.php';

logMessage('INFO', 'auth_callback.php');
$code = isset($_GET['code']) ? trim((string) $_GET['code']) : '';
$stateData = ssoDecodeState(isset($_GET['state']) ? (string) $_GET['state'] : null);
$provider = $stateData['provider'] ?? null;
if ($provider === null && isset($_GET['provider'])) {
    $p = strtolower(trim((string) $_GET['provider']));
    $provider = ($p === 'google' || $p === 'outlook') ? $p : null;
}
$linkUserId = $stateData['link_user_id'] ?? null;
$provider = $provider ?? '';
$base = getBaseUrl();
$appUrl = $base . '/';

if (($provider !== 'google' && $provider !== 'outlook') || $code === '') {
    logMessage('WARNING', 'auth_callback invalid_callback', ['provider' => $provider, 'code_set' => $code !== '']);
    header('Location: ' . $appUrl . '?login_error=invalid_callback');
    exit;
}

logMessage('INFO', 'auth_callback exchange code', ['provider' => $provider, 'link_user_id' => $linkUserId]);
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

$tokenExpires = isset($data['expires_in']) ? date('Y-m-d H:i:s', time() + (int) $data['expires_in']) : null;

$stmt = $master->prepare('SELECT id, master_user_id FROM sso_accounts WHERE provider = ? AND sub = ?');
$stmt->execute([$provider, $data['sub']]);
$existingSso = $stmt->fetch(PDO::FETCH_ASSOC);

if ($linkUserId !== null) {
    $currentUser = getCurrentUser();
    if (!$currentUser || (int) $currentUser['id'] !== $linkUserId) {
        logMessage('WARNING', 'auth_callback sso_link_session_mismatch', ['link_user_id' => $linkUserId]);
        header('Location: ' . $appUrl . '?login_error=sso_link_session');
        exit;
    }
    if ($existingSso && (int) $existingSso['master_user_id'] !== $linkUserId) {
        $otherUserId = (int) $existingSso['master_user_id'];
        $stmt = $master->prepare('SELECT username FROM users WHERE id = ?');
        $stmt->execute([$otherUserId]);
        $otherRow = $stmt->fetch(PDO::FETCH_ASSOC);
        $otherUsername = $otherRow ? (string) $otherRow['username'] : 'another account';

        if (!ssoUserHasPassword($master, $otherUserId)) {
            logMessage('WARNING', 'auth_callback sso_other_sso_only', [
                'provider' => $provider,
                'other_user_id' => $otherUserId,
                'link_user_id' => $linkUserId,
            ]);
            header('Location: ' . $appUrl . '?sso_link_error=sso_other_sso_only');
            exit;
        }

        ssoTransferPendingSet([
            'provider' => $provider,
            'sub' => (string) $data['sub'],
            'email' => (string) $data['email'],
            'target_user_id' => $linkUserId,
            'other_user_id' => $otherUserId,
            'other_username' => $otherUsername,
            'access_token' => $data['access_token'] ?? null,
            'refresh_token' => $data['refresh_token'] ?? null,
            'token_expires_at' => $tokenExpires,
        ]);
        logMessage('INFO', 'auth_callback sso_transfer_pending', [
            'provider' => $provider,
            'from_user_id' => $otherUserId,
            'to_user_id' => $linkUserId,
        ]);
        header('Location: ' . $appUrl . '?sso_transfer_pending=1');
        exit;
    }
    $stmt = $master->prepare('SELECT id FROM sso_accounts WHERE master_user_id = ? AND provider = ?');
    $stmt->execute([$linkUserId, $provider]);
    if ($stmt->fetch()) {
        logMessage('WARNING', 'auth_callback sso_provider_taken', ['provider' => $provider, 'user_id' => $linkUserId]);
        header('Location: ' . $appUrl . '?login_error=sso_provider_taken');
        exit;
    }
    if ($existingSso) {
        $master->prepare('UPDATE sso_accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?, email = ? WHERE provider = ? AND sub = ?')
            ->execute([
                $data['access_token'] ?? null,
                $data['refresh_token'] ?? null,
                $tokenExpires,
                $data['email'],
                $provider,
                $data['sub'],
            ]);
    } else {
        $master->prepare('INSERT INTO sso_accounts (master_user_id, provider, email, sub, access_token, refresh_token, token_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([
                $linkUserId,
                $provider,
                $data['email'],
                $data['sub'],
                $data['access_token'] ?? null,
                $data['refresh_token'] ?? null,
                $tokenExpires,
            ]);
    }
    $stmt = $master->prepare('SELECT id, username, db_name, is_admin, force_password_reset FROM users WHERE id = ?');
    $stmt->execute([$linkUserId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        header('Location: ' . $appUrl . '?login_error=user_not_found');
        exit;
    }
    setSessionUser($row);
    logMessage('INFO', 'auth_callback sso linked', ['user_id' => $linkUserId, 'provider' => $provider]);
    header('Location: ' . $appUrl . '?sso_linked=1');
    exit;
}

if ($existingSso) {
    $userId = (int) $existingSso['master_user_id'];
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
            $tokenExpires,
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
            $tokenExpires,
        ]);
}

setSessionUser($row);
logMessage('INFO', 'auth_callback ok', ['user_id' => (int) $row['id'], 'provider' => $provider]);
header('Location: ' . $appUrl);
exit;
