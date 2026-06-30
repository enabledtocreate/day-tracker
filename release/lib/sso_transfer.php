<?php
/**
 * Pending SSO transfer: move a provider identity from one account to another (exclusive link).
 */
require_once __DIR__ . '/auth.php';

const SSO_TRANSFER_SESSION_KEY = 'sso_pending_transfer';

/**
 * @param array{
 *   provider: string,
 *   sub: string,
 *   email: string,
 *   target_user_id: int,
 *   other_user_id: int,
 *   other_username: string,
 *   access_token: ?string,
 *   refresh_token: ?string,
 *   token_expires_at: ?string
 * } $data
 */
function ssoTransferPendingSet(array $data): void {
    $_SESSION[SSO_TRANSFER_SESSION_KEY] = $data;
}

/** @return array<string, mixed>|null */
function ssoTransferPendingGet(): ?array {
    $pending = $_SESSION[SSO_TRANSFER_SESSION_KEY] ?? null;
    return is_array($pending) ? $pending : null;
}

function ssoTransferPendingClear(): void {
    unset($_SESSION[SSO_TRANSFER_SESSION_KEY]);
}

function ssoUserHasPassword(PDO $master, int $userId): bool {
    $stmt = $master->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return false;
    }
    $hash = $row['password_hash'] ?? null;
    return $hash !== null && $hash !== '';
}

/**
 * Move provider+sub from any account to $targetUserId (deletes prior rows for that identity).
 */
function ssoTransferExecute(PDO $master, int $targetUserId, array $pending): void {
    $provider = (string) ($pending['provider'] ?? '');
    $sub = (string) ($pending['sub'] ?? '');
    if ($provider === '' || $sub === '') {
        throw new InvalidArgumentException('Invalid pending transfer');
    }

    $master->prepare('DELETE FROM sso_accounts WHERE provider = ? AND sub = ?')
        ->execute([$provider, $sub]);
    $master->prepare('DELETE FROM sso_accounts WHERE master_user_id = ? AND provider = ?')
        ->execute([$targetUserId, $provider]);

    $master->prepare(
        'INSERT INTO sso_accounts (master_user_id, provider, email, sub, access_token, refresh_token, token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $targetUserId,
        $provider,
        (string) ($pending['email'] ?? ''),
        $sub,
        $pending['access_token'] ?? null,
        $pending['refresh_token'] ?? null,
        $pending['token_expires_at'] ?? null,
    ]);
}
