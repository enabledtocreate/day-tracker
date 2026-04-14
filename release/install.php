<?php
/**
 * One-time install: run from browser after uploading files, then delete this file.
 * - If daytracker.sqlite exists, renames to daytracker_admin.sqlite and creates admin user in master.
 * - Creates data/, daytracker_master.sqlite (users, app settings, SSO), runs migrations.
 * - Prompts for admin password when creating or migrating to admin user.
 */
header('Content-Type: text/html; charset=utf-8');

$errors = [];
$dataDir = __DIR__ . '/data';
$configPath = __DIR__ . '/config.php';
$configExamplePath = __DIR__ . '/config.example.php';
$masterPath = $dataDir . '/daytracker_master.sqlite';
$legacyPath = $dataDir . '/daytracker.sqlite';
$adminDbPath = $dataDir . '/daytracker_admin.sqlite';
$migrationsDir = __DIR__ . '/migrations';
$migrationsMasterDir = __DIR__ . '/migrations_master';

if (version_compare(PHP_VERSION, '7.4.0', '<')) {
    $errors[] = 'PHP 7.4 or later is required. Current: ' . PHP_VERSION;
}
if (!extension_loaded('pdo_sqlite')) {
    $errors[] = 'PDO SQLite extension is required.';
}

if (!empty($errors)) {
    echo '<!DOCTYPE html><html><head><title>Install – Error</title></head><body><h1>Installation check failed</h1><ul>';
    foreach ($errors as $e) echo '<li>' . htmlspecialchars($e) . '</li>';
    echo '</ul></body></html>';
    exit;
}

// Already installed: config exists and master has schema and at least one user
if (is_file($configPath)) {
    try {
        $config = require $configPath;
        $masterPathCheck = is_array($config) ? ($config['master_db_path'] ?? $dataDir . '/daytracker_master.sqlite') : $dataDir . '/daytracker_master.sqlite';
        if (is_file($masterPathCheck)) {
            $pdo = new PDO('sqlite:' . $masterPathCheck, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $stmt = $pdo->query("SELECT 1 FROM users LIMIT 1");
            if ($stmt && $stmt->fetch()) {
                // Ensure config has all current keys (e.g. SSO); add missing, keep existing values
                $defaults = [
                    'data_dir' => $dataDir,
                    'master_db_path' => $masterPath,
                    'base_url' => '',
                    'openai_api_key' => '',
                    'google_client_id' => '',
                    'google_client_secret' => '',
                    'outlook_client_id' => '',
                    'outlook_client_secret' => '',
                ];
                $merged = is_array($config) ? $config : [];
                foreach ($defaults as $key => $defaultValue) {
                    if (!array_key_exists($key, $merged)) {
                        $merged[$key] = $defaultValue;
                    }
                }
                $lines = ["<?php", "/**", " * Generated/updated by install. Edit as needed.", " */", "return ["];
                foreach ($merged as $key => $value) {
                    $lines[] = "    " . var_export($key, true) . " => " . var_export($value, true) . ",";
                }
                $lines[] = "];";
                @file_put_contents($configPath, implode("\n", $lines));
                echo '<!DOCTYPE html><html><head><title>Already installed</title></head><body><h1>Already installed</h1><p>The app is ready. <strong>Delete install.php</strong> for security.</p></body></html>';
                exit;
            }
        }
    } catch (Throwable $e) {
        @error_log('DayTracker install: already-installed check: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        // continue
    }
}

// Step 1: Data directory
if (!is_dir($dataDir)) {
    if (!@mkdir($dataDir, 0755, true)) {
        $errors[] = 'Could not create data directory: ' . $dataDir;
    }
}

// Step 2: Migrate legacy daytracker.sqlite -> daytracker_admin.sqlite
if (empty($errors) && is_file($legacyPath) && !is_file($adminDbPath)) {
    if (!@rename($legacyPath, $adminDbPath)) {
        $errors[] = 'Could not rename daytracker.sqlite to daytracker_admin.sqlite.';
    }
}

// Step 3: Create master DB and run migrations
if (empty($errors)) {
    try {
        $masterPdo = new PDO('sqlite:' . $masterPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $masterPdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY)");
        if (is_dir($migrationsMasterDir)) {
            $files = glob($migrationsMasterDir . '/*.sql');
            sort($files);
            foreach ($files as $file) {
                $filename = basename($file);
                $stmt = $masterPdo->query("SELECT 1 FROM schema_migrations WHERE filename = " . $masterPdo->quote($filename));
                if ($stmt && $stmt->fetch()) continue;
                $sql = file_get_contents($file);
                if ($sql !== false) $masterPdo->exec($sql);
            }
        }
    } catch (Throwable $e) {
        $errors[] = 'Master DB: ' . $e->getMessage();
    }
}

// Step 4: Run user migrations on admin DB if it exists
if (empty($errors) && is_file($adminDbPath)) {
    try {
        $userPdo = new PDO('sqlite:' . $adminDbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $userPdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY)");
        $files = glob($migrationsDir . '/*.sql');
        sort($files);
        foreach ($files as $file) {
            $filename = basename($file);
            $stmt = $userPdo->query("SELECT 1 FROM schema_migrations WHERE filename = " . $userPdo->quote($filename));
            if ($stmt && $stmt->fetch()) continue;
            $sql = file_get_contents($file);
            if ($sql !== false) $userPdo->exec($sql);
        }
    } catch (Throwable $e) {
        $errors[] = 'Admin user DB migrations: ' . $e->getMessage();
    }
}

// Step 5: Check if admin user exists
$adminExists = false;
if (empty($errors) && is_file($masterPath)) {
    $masterPdo = new PDO('sqlite:' . $masterPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $stmt = $masterPdo->query("SELECT 1 FROM users WHERE username = 'admin'");
    $adminExists = $stmt && $stmt->fetch();
}

// Step 6: Optional config form (includes admin password when admin not yet created)
$optionalConfigSubmitted = isset($_POST['optional_config_submit']) && $_SERVER['REQUEST_METHOD'] === 'POST';

if ($optionalConfigSubmitted && !$adminExists) {
    $adminPassword = isset($_POST['admin_password']) ? trim((string) $_POST['admin_password']) : '';
    if (strlen($adminPassword) < 6) {
        $errors[] = 'Admin password must be at least 6 characters.';
    } else {
        $hash = password_hash($adminPassword, PASSWORD_DEFAULT);
        $masterPdo = new PDO('sqlite:' . $masterPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $masterPdo->prepare('INSERT INTO users (username, password_hash, db_name, is_admin) VALUES (?, ?, ?, 1)')
            ->execute(['admin', $hash, 'daytracker_admin.sqlite']);
        if (!is_file($adminDbPath)) {
            $userPdo = new PDO('sqlite:' . $adminDbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $userPdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY)");
            $files = glob($migrationsDir . '/*.sql');
            sort($files);
            foreach ($files as $file) {
                $filename = basename($file);
                $sql = file_get_contents($file);
                if ($sql !== false) $userPdo->exec($sql);
            }
        }
        $adminExists = true;
    }
}

$showOptionalConfigForm = (empty($errors) && !$optionalConfigSubmitted) || ($optionalConfigSubmitted && !empty($errors));
if ($showOptionalConfigForm) {
    ?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Configuration</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.25rem; }
    p { color: #555; font-size: 0.9rem; }
    label { display: block; margin: 0.75rem 0 0.25rem; font-weight: 500; }
    input[type=text], input[type=password] { width: 100%; padding: 0.35rem; box-sizing: border-box; }
    .hint { font-size: 0.8rem; color: #666; margin-top: 0.15rem; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; cursor: pointer; }
    .section { margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid #ddd; }
    .error { color: #c00; font-size: 0.9rem; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>Configuration</h1>
  <?php if (!empty($errors)): ?>
  <ul class="error">
    <?php foreach ($errors as $e): ?>
    <li><?php echo htmlspecialchars($e); ?></li>
    <?php endforeach; ?>
  </ul>
  <?php endif; ?>
  <?php if (!$adminExists): ?>
  <p>Set the <strong>admin</strong> account password (required).</p>
  <?php endif; ?>
  <p>Optional: add API keys and SSO below, or leave blank and set them later in <code>config.php</code>.</p>
  <form method="post">
    <input type="hidden" name="optional_config_submit" value="1" />
    <?php if (!$adminExists): ?>
    <div class="section">
      <strong>Admin account</strong>
      <label>Admin password (min 6 characters) <input type="password" name="admin_password" minlength="6" required autocomplete="new-password" /></label>
    </div>
    <?php endif; ?>

    <label>OpenAI API key (for AI chat panel)</label>
    <input type="password" name="openai_api_key" value="" placeholder="sk-..." autocomplete="off" />
    <div class="hint">From platform.openai.com → API keys</div>

    <div class="section">
      <strong>Sign in with Google</strong>
      <label>Google Client ID</label>
      <input type="text" name="google_client_id" value="" placeholder="" />
      <label>Google Client secret</label>
      <input type="password" name="google_client_secret" value="" autocomplete="off" />
    </div>

    <div class="section">
      <strong>Sign in with Microsoft / Outlook</strong>
      <label>Outlook / Microsoft Client ID</label>
      <input type="text" name="outlook_client_id" value="" placeholder="" />
      <label>Outlook / Microsoft Client secret</label>
      <input type="password" name="outlook_client_secret" value="" autocomplete="off" />
    </div>

    <button type="submit">Continue and finish installation</button>
  </form>
</body>
</html>
    <?php
    exit;
}

if (empty($errors) && $optionalConfigSubmitted) {
    $defaults = [
        'data_dir' => $dataDir,
        'master_db_path' => $masterPath,
        'openai_api_key' => trim((string) ($_POST['openai_api_key'] ?? '')),
        'google_client_id' => trim((string) ($_POST['google_client_id'] ?? '')),
        'google_client_secret' => trim((string) ($_POST['google_client_secret'] ?? '')),
        'outlook_client_id' => trim((string) ($_POST['outlook_client_id'] ?? '')),
        'outlook_client_secret' => trim((string) ($_POST['outlook_client_secret'] ?? '')),
    ];
    $config = [];
    if (is_file($configPath)) {
        $loaded = @require $configPath;
        if (is_array($loaded)) {
            $config = $loaded;
        }
    }
    foreach ($defaults as $key => $defaultValue) {
        if (!array_key_exists($key, $config)) {
            $config[$key] = $defaultValue;
        } else {
            // Use submitted values for optional keys so install form can set them
            if (in_array($key, ['openai_api_key', 'google_client_id', 'google_client_secret', 'outlook_client_id', 'outlook_client_secret'], true)) {
                $config[$key] = $defaultValue;
            }
        }
    }
    $lines = ["<?php", "/**", " * Generated/updated by install. Edit as needed.", " */", "return ["];
    foreach ($config as $key => $value) {
        $lines[] = "    " . var_export($key, true) . " => " . var_export($value, true) . ",";
    }
    $lines[] = "];";
    if (!@file_put_contents($configPath, implode("\n", $lines))) {
        $errors[] = 'Could not write config.php.';
    }
}

if (!empty($errors)) {
    echo '<!DOCTYPE html><html><head><title>Install – Error</title></head><body><h1>Installation failed</h1><ul>';
    foreach ($errors as $e) echo '<li>' . htmlspecialchars($e) . '</li>';
    echo '</ul></body></html>';
    exit;
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Installation complete</title>
</head>
<body>
  <h1>Installation complete</h1>
  <p>The app is ready. <strong>Delete install.php</strong> for security.</p>
</body>
</html>
