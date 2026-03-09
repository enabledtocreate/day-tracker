<?php
/**
 * SSO helpers: build redirect URL, exchange code for tokens, get user info. PHP only (no npm).
 */
require_once __DIR__ . '/db.php';

function getBaseUrl(): string {
    $config = getConfig();
    if (!empty($config['base_url'])) {
        return rtrim($config['base_url'], '/');
    }
    $scheme = 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script = $_SERVER['SCRIPT_NAME'] ?? '';
    $base = dirname($script);
    if (strpos($base, '/api') !== false) {
        $base = dirname($base);
    }
    return $scheme . '://' . $host . ($base === '/' ? '' : $base);
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
