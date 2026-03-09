<?php
/**
 * Auth API: login, register, me, logout. No requireAuth — used to establish session.
 */
require_once dirname(__DIR__) . '/lib/auth.php';
require_once dirname(__DIR__) . '/lib/db.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/demo_seed.php';

header('Content-Type: application/json; charset=utf-8');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';

if ($method === 'GET' && $action === 'me') {
    logMessage('INFO', 'auth action me');
    $user = getCurrentUser();
    if (!$user) {
        logMessage('INFO', 'auth me no session');
        http_response_code(200);
        echo json_encode(['user' => null]);
        exit;
    }
    $master = getMasterPdo();
    $stmt = $master->prepare('SELECT id, username, db_name, is_admin, force_password_reset FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        logMessage('WARNING', 'auth me user not in db', ['user_id' => $user['id']]);
        logout();
        http_response_code(200);
        echo json_encode(['user' => null]);
        exit;
    }
    logMessage('INFO', 'auth me ok', ['user_id' => (int) $row['id']]);
    $master = getMasterPdo();
    $stmt = $master->prepare('SELECT provider, email FROM sso_accounts WHERE master_user_id = ?');
    $stmt->execute([$row['id']]);
    $sso = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $aiEnabled = true;
    $st = $master->query("SELECT value FROM app_settings WHERE key = 'ai_enabled'");
    if ($st && ($r = $st->fetch(PDO::FETCH_ASSOC))) $aiEnabled = $r['value'] !== '0';
    echo json_encode([
        'user' => [
            'id' => (int) $row['id'],
            'username' => $row['username'],
            'db_name' => $row['db_name'],
            'is_admin' => (bool) $row['is_admin'],
            'force_password_reset' => (bool) $row['force_password_reset'],
            'sso' => $sso,
        ],
        'ai_enabled' => $aiEnabled,
    ]);
    exit;
}

if ($method === 'POST' && $action === 'logout') {
    logMessage('INFO', 'auth action logout');
    $user = getCurrentUser();
    if ($user && ($user['username'] ?? '') === 'demo') {
        $master = getMasterPdo();
        resetDemoUser($master, getDataDir());
        setDemoLastResetDate($master, date('Y-m-d'));
    }
    logout();
    logMessage('INFO', 'auth logout ok');
    echo json_encode(['ok' => true]);
    exit;
}

if ($method === 'GET' && $action === 'sso') {
    logMessage('INFO', 'auth action sso redirect');
    $provider = isset($_GET['provider']) ? strtolower(trim((string) $_GET['provider'])) : '';
    if ($provider !== 'google' && $provider !== 'outlook') {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid provider']);
        exit;
    }
    require_once dirname(__DIR__) . '/lib/sso.php';
    $url = ssoRedirectUrl($provider);
    if (!$url) {
        http_response_code(503);
        echo json_encode(['error' => 'SSO not configured for this provider']);
        exit;
    }
    header('Location: ' . $url);
    exit;
}

if ($method === 'POST' && ($action === 'login' || $action === 'register')) {
    logMessage('INFO', 'auth action ' . $action);
    $raw = file_get_contents('php://input');
    $in = $raw ? json_decode($raw, true) : null;
    $in = is_array($in) ? $in : [];
    $username = isset($in['username']) ? trim((string) $in['username']) : '';
    $password = isset($in['password']) ? (string) $in['password'] : '';

    if ($username === '' || $password === '') {
        logMessage('WARNING', 'auth ' . $action . ' validation username or password empty');
        http_response_code(400);
        echo json_encode(['error' => 'Username and password required']);
        exit;
    }

    $username = preg_replace('/[^a-zA-Z0-9_-]/', '', $username);
    if ($username === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid username']);
        exit;
    }

    $master = getMasterPdo();
    $dbName = 'daytracker_' . $username . '.sqlite';
    $dataDir = getDataDir();

    if ($action === 'register') {
        if ($username === 'demo') {
            http_response_code(400);
            echo json_encode(['error' => 'Use Login to use the demo account.']);
            exit;
        }
        $stmt = $master->prepare('SELECT 1 FROM users WHERE username = ? OR db_name = ?');
        $stmt->execute([$username, $dbName]);
        if ($stmt->fetch()) {
            http_response_code(400);
            echo json_encode(['error' => 'Username already exists']);
            exit;
        }
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $master->prepare('INSERT INTO users (username, password_hash, db_name, is_admin) VALUES (?, ?, ?, 0)')
            ->execute([$username, $hash, $dbName]);
        $userId = (int) $master->lastInsertId();
        $userPath = $dataDir . '/' . $dbName;
        $pdo = new PDO('sqlite:' . $userPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        runMigrationsIn($pdo, dirname(__DIR__) . '/migrations');
        $stmt = $master->prepare('SELECT id, username, db_name, is_admin, force_password_reset FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        setSessionUser($row);
        logMessage('INFO', 'auth register ok', ['user_id' => $userId]);
        echo json_encode(['ok' => true, 'user' => ['username' => $row['username'], 'is_admin' => (bool) $row['is_admin']]]);
        exit;
    }

    if ($action === 'login') {
        if ($username === 'demo') {
            try {
                ensureDemoUserExists($master, $dataDir);
                $stmt = $master->prepare('SELECT id, username, password_hash, db_name, is_admin, force_password_reset FROM users WHERE username = ?');
                $stmt->execute(['demo']);
                $row = $stmt->fetch(PDO::FETCH_ASSOC);
                if (!$row || !password_verify($password, $row['password_hash'])) {
                    logMessage('WARNING', 'auth login demo invalid');
                    http_response_code(401);
                    echo json_encode(['error' => 'Invalid username or password']);
                    exit;
                }
                resetDemoUser($master, $dataDir);
                setDemoLastResetDate($master, date('Y-m-d'));
                setSessionUser($row);
                logMessage('INFO', 'auth login demo ok');
                echo json_encode(['ok' => true, 'user' => ['username' => $row['username'], 'is_admin' => (bool) $row['is_admin'], 'force_password_reset' => false]]);
                exit;
            } catch (Throwable $e) {
                logError('ERROR', 'Demo login failed: ' . $e->getMessage(), [
                    'file' => $e->getFile(),
                    'line' => $e->getLine(),
                    'trace' => $e->getTraceAsString(),
                ]);
                http_response_code(500);
                echo json_encode(['error' => 'Demo login failed.', 'message' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine()]);
                exit;
            }
        }

        $stmt = $master->prepare('SELECT id, username, password_hash, db_name, is_admin, force_password_reset FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || !$row['password_hash']) {
            logMessage('WARNING', 'auth login invalid', ['username' => $username]);
            http_response_code(401);
            echo json_encode(['error' => 'Invalid username or password']);
            exit;
        }
        if (!password_verify($password, $row['password_hash'])) {
            logMessage('WARNING', 'auth login invalid password', ['username' => $username]);
            http_response_code(401);
            echo json_encode(['error' => 'Invalid username or password']);
            exit;
        }
        $userPath = $dataDir . '/' . $row['db_name'];
        if (!is_file($userPath)) {
            $pdo = new PDO('sqlite:' . $userPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            runMigrationsIn($pdo, dirname(__DIR__) . '/migrations');
        }
        setSessionUser($row);
        logMessage('INFO', 'auth login ok', ['user_id' => (int) $row['id'], 'username' => $row['username']]);
        echo json_encode(['ok' => true, 'user' => ['username' => $row['username'], 'is_admin' => (bool) $row['is_admin'], 'force_password_reset' => (bool) $row['force_password_reset']]]);
        exit;
    }
}

http_response_code(400);
echo json_encode(['error' => 'Bad request']);
