<?php
/**
 * User profile: change password, disconnect SSO (then set password), get profile.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$user = getCurrentUser();
if (!$user) {
    logMessage('INFO', 'user.php unauthorized');
    jsonError('Unauthorized', 401);
    exit;
}

$userId = (int) $user['id'];
$master = getMasterPdo();
logMessage('INFO', 'user.php branch', ['method' => $method, 'user_id' => $userId]);

if ($method === 'GET') {
    logMessage('INFO', 'user GET profile');
    $stmt = $master->prepare('SELECT id, username, db_name, is_admin FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        logMessage('WARNING', 'user GET not found', ['user_id' => $userId]);
        jsonError('User not found', 404);
        exit;
    }
    $stmt = $master->prepare('SELECT id, provider, email FROM sso_accounts WHERE master_user_id = ?');
    $stmt->execute([$row['id']]);
    $sso = $stmt->fetchAll(PDO::FETCH_ASSOC);
    jsonResponse([
        'user' => [
            'id' => (int) $row['id'],
            'username' => $row['username'],
            'db_name' => $row['db_name'],
            'is_admin' => (bool) $row['is_admin'],
            'sso' => $sso,
        ],
    ]);
    logMessage('INFO', 'user GET profile ok');
    exit;
}

if ($method === 'PATCH' || $method === 'POST') {
    $in = readJsonInput();
    if (!$in) $in = [];

    if (isset($in['password'])) {
        logMessage('INFO', 'user PATCH password');
        $stmt = $master->prepare('SELECT username FROM users WHERE id = ?');
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row && ($row['username'] ?? '') === 'demo') {
            jsonError('Password cannot be changed for the demo account.', 400);
            exit;
        }
        $password = (string) $in['password'];
        if (strlen($password) < 6) {
            jsonError('Password must be at least 6 characters', 400);
            exit;
        }
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $master->prepare('UPDATE users SET password_hash = ?, force_password_reset = 0 WHERE id = ?')
            ->execute([$hash, $user['id']]);
        logMessage('INFO', 'user password updated ok');
        jsonResponse(['ok' => true]);
        exit;
    }

    if (isset($in['disconnect_sso']) && (int) $in['disconnect_sso'] > 0) {
        logMessage('INFO', 'user PATCH disconnect_sso');
        $stmt = $master->prepare('SELECT username FROM users WHERE id = ?');
        $stmt->execute([$user['id']]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row && ($row['username'] ?? '') === 'demo') {
            jsonError('Cannot disconnect SSO for the demo account.', 400);
            exit;
        }
        $ssoId = (int) $in['disconnect_sso'];
        $stmt = $master->prepare('SELECT id FROM sso_accounts WHERE id = ? AND master_user_id = ?');
        $stmt->execute([$ssoId, $user['id']]);
        if (!$stmt->fetch()) {
            jsonError('SSO account not found', 400);
            exit;
        }
        $master->prepare('DELETE FROM sso_accounts WHERE id = ?')->execute([$ssoId]);
        $newPassword = isset($in['new_password']) ? (string) $in['new_password'] : '';
        if (strlen($newPassword) < 6) {
            jsonError('Set a password (min 6 characters) after disconnecting SSO', 400);
            exit;
        }
        $hash = password_hash($newPassword, PASSWORD_DEFAULT);
        $master->prepare('UPDATE users SET password_hash = ?, force_password_reset = 0 WHERE id = ?')
            ->execute([$hash, $user['id']]);
        logMessage('INFO', 'user disconnect_sso ok');
        jsonResponse(['ok' => true]);
        exit;
    }
}

logMessage('WARNING', 'user bad request');
jsonError('Bad request', 400);
