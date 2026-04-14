<?php
/**
 * SSO helpers: build redirect URL, exchange code for tokens, get user info. PHP only (no npm).
 */
require_once __DIR__ . '/db.php';

/** True when the incoming request is HTTPS (or behind a TLS-terminating proxy). */
function ssoRequestIsHttps(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') {
        return true;
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_SSL']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_SSL']) === 'on') {
        return true;
    }
    return false;
}

/**
 * Public origin for OAuth redirect_uri and post-login redirects.
 * Set `base_url` in config.php when auto-detection is wrong (e.g. subfolder behind reverse proxy).
 */
function getBaseUrl(): string {
    $config = getConfig();
    if (!empty($config['base_url'])) {
        return rtrim((string) $config['base_url'], '/');
    }
    $scheme = ssoRequestIsHttps() ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    $base = dirname($script);
    if (strpos($base, '/api') !== false) {
        $base = dirname($base);
    }
    return $scheme . '://' . $host . ($base === '/' ? '' : $base);
}

/** Encode provider for OAuth `state` (IdPs do not append `provider` to the callback query). */
function ssoEncodeState(string $provider): string {
    $raw = json_encode(['p' => $provider]);
    if ($raw === false) {
        return '';
    }
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

/** @return 'google'|'outlook'|null */
function ssoDecodeState(?string $state): ?string {
    if ($state === null || $state === '') {
        return null;
    }
    $b64 = strtr($state, '-_', '+/');
    $pad = strlen($b64) % 4;
    if ($pad > 0) {
        $b64 .= str_repeat('=', 4 - $pad);
    }
    $raw = base64_decode($b64, true);
    if ($raw === false) {
        return null;
    }
    $data = json_decode($raw, true);
    if (!is_array($data) || empty($data['p'])) {
        return null;
    }
    $p = strtolower((string) $data['p']);
    return ($p === 'google' || $p === 'outlook') ? $p : null;
}

function httpPostJson(string $url, array $data, array $headers = []): array {
    $ctx = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n" . implode("\r\n", $headers),
            'content' => http_build_query($data),
            'timeout' => 15,
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function ssoRedirectUrl(string $provider): ?string {
    $config = getConfig();
    $base = getBaseUrl();
    $callback = $base . '/api/auth_callback.php';

    if ($provider === 'google') {
        $clientId = $config['google_client_id'] ?? '';
        if ($clientId === '') return null;
        $params = [
            'client_id' => $clientId,
            'redirect_uri' => $callback,
            'response_type' => 'code',
            'scope' => 'openid email profile',
            'access_type' => 'offline',
            'prompt' => 'consent',
            'state' => ssoEncodeState('google'),
        ];
        return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params);
    }

    if ($provider === 'outlook') {
        $clientId = $config['outlook_client_id'] ?? '';
        if ($clientId === '') return null;
        $params = [
            'client_id' => $clientId,
            'redirect_uri' => $callback,
            'response_type' => 'code',
            'scope' => 'openid email profile',
            'state' => ssoEncodeState('outlook'),
        ];
        return 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' . http_build_query($params);
    }

    return null;
}

function ssoExchangeCode(string $provider, string $code): array {
    $config = getConfig();
    $base = getBaseUrl();
    $callback = $base . '/api/auth_callback.php';

    if ($provider === 'google') {
        $clientId = $config['google_client_id'] ?? '';
        $clientSecret = $config['google_client_secret'] ?? '';
        if ($clientId === '' || $clientSecret === '') return [];
        $resp = httpPostJson('https://oauth2.googleapis.com/token', [
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'code' => $code,
            'grant_type' => 'authorization_code',
            'redirect_uri' => $callback,
        ]);
        $accessToken = $resp['access_token'] ?? null;
        if (!$accessToken) return [];
        $userResp = @file_get_contents('https://www.googleapis.com/oauth2/v2/userinfo?access_token=' . urlencode($accessToken));
        $userInfo = $userResp ? json_decode($userResp, true) : null;
        if (!is_array($userInfo) || empty($userInfo['id'])) return [];
        return [
            'sub' => $userInfo['id'],
            'email' => $userInfo['email'] ?? '',
            'access_token' => $accessToken,
            'refresh_token' => $resp['refresh_token'] ?? null,
            'expires_in' => $resp['expires_in'] ?? null,
        ];
    }

    if ($provider === 'outlook') {
        $clientId = $config['outlook_client_id'] ?? '';
        $clientSecret = $config['outlook_client_secret'] ?? '';
        if ($clientId === '' || $clientSecret === '') return [];
        $resp = httpPostJson('https://login.microsoftonline.com/common/oauth2/v2.0/token', [
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'code' => $code,
            'grant_type' => 'authorization_code',
            'redirect_uri' => $callback,
        ]);
        $accessToken = $resp['access_token'] ?? null;
        if (!$accessToken) return [];
        $ctx = stream_context_create([
            'http' => [
                'header' => 'Authorization: Bearer ' . $accessToken,
            ],
        ]);
        $userResp = @file_get_contents('https://graph.microsoft.com/v1.0/me', false, $ctx);
        $userInfo = $userResp ? json_decode($userResp, true) : null;
        if (!is_array($userInfo) || empty($userInfo['id'])) return [];
        $email = $userInfo['mail'] ?? $userInfo['userPrincipalName'] ?? '';
        return [
            'sub' => $userInfo['id'],
            'email' => $email,
            'access_token' => $accessToken,
            'refresh_token' => $resp['refresh_token'] ?? null,
            'expires_in' => $resp['expires_in'] ?? null,
        ];
    }

    return [];
}
