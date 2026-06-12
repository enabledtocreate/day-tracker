<?php
/**
 * App settings API: GET (time view: start_hour, end_hour, increment_value, increment_unit), PATCH.
 */
require_once __DIR__ . '/common.php';
require_once dirname(__DIR__) . '/lib/logger.php';
require_once dirname(__DIR__) . '/lib/task_layout.php';

$pdo = getPdoSafe();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
logMessage('INFO', 'settings.php branch', ['method' => $method, 'user_id' => $userId]);

$keys = ['start_hour', 'end_hour', 'increment_value', 'increment_unit', 'timezone', 'task_schedule_layout'];
/** Not in $keys loop (non-integer string values). */
/** Not in $keys loop (non-integer string values). */

/** @return string JSON or '' if invalid */
function sanitize_priority_theme_json(string $raw): string
{
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return '';
    }
    $order = ['commitment', 'high', 'medium', 'low'];
    $defaults = [
        'commitment' => ['label' => 'Commitment', 'icon' => '★'],
        'high' => ['label' => 'High', 'icon' => '↑'],
        'medium' => ['label' => 'Medium', 'icon' => '●'],
        'low' => ['label' => 'Low', 'icon' => '↓'],
    ];
    $out = [];
    foreach ($order as $k) {
        $row = isset($decoded[$k]) && is_array($decoded[$k]) ? $decoded[$k] : [];
        $label = isset($row['label']) ? mb_substr(trim((string) $row['label']), 0, 48) : '';
        $icon = isset($row['icon']) ? mb_substr(trim((string) $row['icon']), 0, 16) : '';
        $color = isset($row['color']) ? trim((string) $row['color']) : '';
        if ($color !== '' && !preg_match('/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $color)) {
            $color = '';
        }
        $item = [
            'label' => $label !== '' ? $label : $defaults[$k]['label'],
            'icon' => $icon !== '' ? $icon : $defaults[$k]['icon'],
        ];
        if ($color !== '') {
            $item['color'] = $color;
        }
        $out[$k] = $item;
    }
    return json_encode($out);
}

/** @return string JSON or '' if invalid */
function sanitize_bucket_labels_json(string $raw): string
{
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return '';
    }
    $u = isset($decoded['unassigned']) ? mb_substr(trim((string) $decoded['unassigned']), 0, 40) : '';
    $p = isset($decoded['pending']) ? mb_substr(trim((string) $decoded['pending']), 0, 40) : '';
    if ($u === '' && $p === '') {
        return '';
    }
    return json_encode([
        'unassigned' => $u !== '' ? $u : 'Unassigned',
        'pending' => $p !== '' ? $p : 'Pending',
    ]);
}

/** @return string JSON or '' if invalid */
function sanitize_priority_layout_json(string $raw): string
{
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return '';
    }
    if (($decoded['mode'] ?? '') !== 'custom') {
        return '';
    }
    $rows = isset($decoded['priorities']) && is_array($decoded['priorities']) ? $decoded['priorities'] : [];
    $out = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = isset($row['id']) ? trim((string) $row['id']) : '';
        if (!dt_slug_ok($id)) {
            continue;
        }
        $label = isset($row['label']) ? mb_substr(trim((string) $row['label']), 0, 48) : '';
        $icon = isset($row['icon']) ? mb_substr(trim((string) $row['icon']), 0, 16) : '';
        $color = isset($row['color']) ? trim((string) $row['color']) : '';
        if ($color !== '' && !preg_match('/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $color)) {
            $color = '';
        }
        $item = [
            'id' => $id,
            'label' => $label !== '' ? $label : $id,
            'icon' => $icon !== '' ? $icon : '●',
        ];
        if ($color !== '') {
            $item['color'] = $color;
        }
        $out[] = $item;
    }
    $seen = [];
    $uniq = [];
    foreach ($out as $item) {
        if (isset($seen[$item['id']])) {
            continue;
        }
        $seen[$item['id']] = true;
        $uniq[] = $item;
    }
    if (count($uniq) < 2 || count($uniq) > 24) {
        return '';
    }

    return json_encode(['version' => 2, 'mode' => 'custom', 'priorities' => $uniq]);
}

/** @return string JSON or '' if invalid */
function sanitize_bucket_layout_json(string $raw): string
{
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return '';
    }
    if (($decoded['mode'] ?? '') !== 'custom') {
        return '';
    }
    $rows = isset($decoded['buckets']) && is_array($decoded['buckets']) ? $decoded['buckets'] : [];
    $out = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = isset($row['id']) ? trim((string) $row['id']) : '';
        if (!dt_slug_ok($id)) {
            continue;
        }
        $label = isset($row['label']) ? mb_substr(trim((string) $row['label']), 0, 48) : '';
        $out[] = [
            'id' => $id,
            'label' => $label !== '' ? $label : $id,
        ];
    }
    $seen = [];
    $uniq = [];
    foreach ($out as $b) {
        if (isset($seen[$b['id']])) {
            continue;
        }
        $seen[$b['id']] = true;
        $uniq[] = $b;
    }
    if (count($uniq) < 2 || count($uniq) > 16) {
        return '';
    }

    return json_encode(['version' => 2, 'mode' => 'custom', 'buckets' => $uniq]);
}

/** @return string JSON or '' if invalid */
function sanitize_contact_link_json(string $raw): string
{
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return '';
    }
    $allowedEmail = ['mailto', 'gmail', 'outlook_web', 'yahoo_web'];
    $allowedPhone = ['tel', 'sms'];
    $email = isset($decoded['email']) ? (string) $decoded['email'] : 'mailto';
    $phone = isset($decoded['phone']) ? (string) $decoded['phone'] : 'tel';
    if (!in_array($email, $allowedEmail, true)) {
        $email = 'mailto';
    }
    if (!in_array($phone, $allowedPhone, true)) {
        $phone = 'tel';
    }
    $gmailAccount = isset($decoded['gmail_account']) ? (int) $decoded['gmail_account'] : 0;
    if ($gmailAccount < 0) {
        $gmailAccount = 0;
    }
    if ($gmailAccount > 5) {
        $gmailAccount = 5;
    }
    $profileId = isset($decoded['gmail_profile_id']) ? trim((string) $decoded['gmail_profile_id']) : 'default';
    if ($profileId === '') {
        $profileId = 'default';
    }
    if (strlen($profileId) > 64) {
        $profileId = substr($profileId, 0, 64);
    }
    $profiles = [];
    if (isset($decoded['gmail_profiles']) && is_array($decoded['gmail_profiles'])) {
        foreach ($decoded['gmail_profiles'] as $row) {
            if (!is_array($row)) {
                continue;
            }
            $id = isset($row['id']) ? trim((string) $row['id']) : '';
            $name = isset($row['name']) ? trim((string) $row['name']) : '';
            if ($id === '' || $name === '') {
                continue;
            }
            if (strlen($id) > 64) {
                $id = substr($id, 0, 64);
            }
            if (strlen($name) > 48) {
                $name = substr($name, 0, 48);
            }
            $compose = isset($row['compose_slot']) ? (int) $row['compose_slot'] : 0;
            if ($compose < 0) {
                $compose = 0;
            }
            if ($compose > 5) {
                $compose = 5;
            }
            $slots = [];
            if (isset($row['slots']) && is_array($row['slots'])) {
                foreach ($row['slots'] as $slotKey => $slotLabel) {
                    $idx = (int) $slotKey;
                    if ($idx < 0 || $idx > 5) {
                        continue;
                    }
                    $label = trim((string) $slotLabel);
                    if ($label === '') {
                        continue;
                    }
                    if (strlen($label) > 64) {
                        $label = substr($label, 0, 64);
                    }
                    $slots[(string) $idx] = $label;
                }
            }
            $profiles[] = [
                'id' => $id,
                'name' => $name,
                'compose_slot' => $compose,
                'slots' => $slots,
            ];
            if (count($profiles) >= 12) {
                break;
            }
        }
    }
    if (count($profiles) === 0) {
        $profiles[] = [
            'id' => 'default',
            'name' => 'Default browser',
            'compose_slot' => $gmailAccount,
            'slots' => new stdClass(),
        ];
        $profileId = 'default';
    }
    $knownIds = array_column($profiles, 'id');
    if (!in_array($profileId, $knownIds, true)) {
        $profileId = (string) $profiles[0]['id'];
    }
    return json_encode([
        'email' => $email,
        'phone' => $phone,
        'gmail_account' => $gmailAccount,
        'gmail_profile_id' => $profileId,
        'gmail_profiles' => $profiles,
    ]);
}

if ($method === 'GET') {
    logMessage('INFO', 'settings GET');
    $stmt = $pdo->query("SELECT key, value FROM app_settings WHERE key IN ('start_hour','end_hour','increment_value','increment_unit','timezone','task_schedule_layout','ui_theme','priority_theme_json','priority_layout_json','bucket_labels_json','bucket_layout_json','due_auto_priority_target','auto_priority_default_mode','auto_priority_default_days_per_step','weather_latitude','weather_longitude','weather_location_label','weather_temp_unit','schedule_hide_category_subcategory','schedule_hide_tags','mobile_schedule_glance','bulk_import_json','contact_link_json')");
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_KEY_PAIR) : [];
    $settings = [
        'start_hour' => (int) ($rows['start_hour'] ?? 6),
        'end_hour' => (int) ($rows['end_hour'] ?? 23),
        'increment_value' => (int) ($rows['increment_value'] ?? 15),
        'increment_unit' => $rows['increment_unit'] ?? 'min',
        'timezone' => isset($rows['timezone']) ? (string) $rows['timezone'] : '',
        'task_schedule_layout' => isset($rows['task_schedule_layout']) ? (string) $rows['task_schedule_layout'] : 'stacked',
    ];
    if ($settings['increment_unit'] !== 'min' && $settings['increment_unit'] !== 'hr') {
        $settings['increment_unit'] = 'min';
    }
    if ($settings['task_schedule_layout'] !== 'stacked' && $settings['task_schedule_layout'] !== 'split') {
        $settings['task_schedule_layout'] = 'stacked';
    }
    $ut = isset($rows['ui_theme']) ? (string) $rows['ui_theme'] : 'dark';
    $settings['ui_theme'] = ($ut === 'light') ? 'light' : 'dark';
    $ut = isset($rows['ui_theme']) ? (string) $rows['ui_theme'] : 'dark';
    $settings['ui_theme'] = ($ut === 'light') ? 'light' : 'dark';
    if (isset($rows['priority_theme_json']) && $rows['priority_theme_json'] !== '') {
        $settings['priority_theme_json'] = (string) $rows['priority_theme_json'];
    }
    if (isset($rows['priority_layout_json']) && $rows['priority_layout_json'] !== '') {
        $settings['priority_layout_json'] = (string) $rows['priority_layout_json'];
    }
    if (isset($rows['bucket_labels_json']) && $rows['bucket_labels_json'] !== '') {
        $settings['bucket_labels_json'] = (string) $rows['bucket_labels_json'];
    }
    if (isset($rows['bucket_layout_json']) && $rows['bucket_layout_json'] !== '') {
        $settings['bucket_layout_json'] = (string) $rows['bucket_layout_json'];
    }
    if (isset($rows['due_auto_priority_target'])) {
        $t = (string) $rows['due_auto_priority_target'];
        $layout = dt_task_layout_from_settings_rows($rows);
        if (dt_is_allowed_due_auto_target($t, $layout)) {
            $settings['due_auto_priority_target'] = $t;
        }
    }
    $apm = isset($rows['auto_priority_default_mode']) ? (string) $rows['auto_priority_default_mode'] : 'days';
    $settings['auto_priority_default_mode'] = ($apm === 'due_date') ? 'due_date' : 'days';
    $apd = isset($rows['auto_priority_default_days_per_step']) ? (int) $rows['auto_priority_default_days_per_step'] : 1;
    if ($apd < 1) {
        $apd = 1;
    }
    if ($apd > 365) {
        $apd = 365;
    }
    $settings['auto_priority_default_days_per_step'] = $apd;
    if (isset($rows['weather_latitude']) && $rows['weather_latitude'] !== '') {
        $settings['weather_latitude'] = (float) $rows['weather_latitude'];
    }
    if (isset($rows['weather_longitude']) && $rows['weather_longitude'] !== '') {
        $settings['weather_longitude'] = (float) $rows['weather_longitude'];
    }
    if (isset($rows['weather_location_label']) && $rows['weather_location_label'] !== '') {
        $settings['weather_location_label'] = (string) $rows['weather_location_label'];
    }
    $wtu = isset($rows['weather_temp_unit']) ? strtoupper((string) $rows['weather_temp_unit']) : 'C';
    $settings['weather_temp_unit'] = ($wtu === 'F') ? 'F' : 'C';
    $settings['schedule_hide_category_subcategory'] = isset($rows['schedule_hide_category_subcategory']) && (string) $rows['schedule_hide_category_subcategory'] === '1';
    $settings['schedule_hide_tags'] = isset($rows['schedule_hide_tags']) && (string) $rows['schedule_hide_tags'] === '1';
    // Mobile-only simplified schedule view (see TODO-mobile.md §0.6).
    $settings['mobile_schedule_glance'] = isset($rows['mobile_schedule_glance']) && (string) $rows['mobile_schedule_glance'] === '1';
    // Mobile-only simplified schedule view (see TODO-mobile.md §0.6).
    $settings['mobile_schedule_glance'] = isset($rows['mobile_schedule_glance']) && (string) $rows['mobile_schedule_glance'] === '1';
    if (isset($rows['bulk_import_json']) && $rows['bulk_import_json'] !== '') {
        $settings['bulk_import_json'] = (string) $rows['bulk_import_json'];
    }
    if (isset($rows['contact_link_json']) && $rows['contact_link_json'] !== '') {
        $settings['contact_link_json'] = (string) $rows['contact_link_json'];
    }
    logMessage('INFO', 'settings GET ok');
    jsonResponse($settings);
    exit;
}

if ($method === 'PATCH') {
    logMessage('INFO', 'settings PATCH');
    $in = readJsonInput();
    if (!$in || !is_array($in)) {
        logMessage('WARNING', 'settings PATCH body required');
        jsonError('JSON body required');
        exit;
    }
    $stmt = $pdo->prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    foreach ($keys as $key) {
        if (!array_key_exists($key, $in)) {
            continue;
        }
        $v = $in[$key];
        if ($key === 'timezone') {
            $v = is_string($v) ? trim($v) : '';
        } elseif ($key === 'increment_unit') {
            $v = ($v === 'hr' || $v === 'min') ? $v : 'min';
        } elseif ($key === 'task_schedule_layout') {
            $v = is_string($v) && ($v === 'split' || $v === 'stacked') ? $v : 'stacked';
        } else {
            $v = (string) (int) $v;
        }
        $stmt->execute([$key, $v]);
    }

    $del = $pdo->prepare('DELETE FROM app_settings WHERE key = ?');
    if (array_key_exists('priority_theme_json', $in)) {
        $v = $in['priority_theme_json'];
        if ($v === null || $v === '') {
            $del->execute(['priority_theme_json']);
        } elseif (is_string($v)) {
            $clean = sanitize_priority_theme_json($v);
            if ($clean !== '') {
                $stmt->execute(['priority_theme_json', $clean]);
            }
        }
    }
    if (array_key_exists('priority_layout_json', $in)) {
        $v = $in['priority_layout_json'];
        if ($v === null || $v === '') {
            $del->execute(['priority_layout_json']);
            $pdo->exec("UPDATE tasks SET priority = CASE WHEN priority IN ('commitment','high','medium','low') THEN priority ELSE 'medium' END");
        } elseif (is_string($v)) {
            $clean = sanitize_priority_layout_json($v);
            if ($clean !== '') {
                $stmt->execute(['priority_layout_json', $clean]);
                $decoded = json_decode($clean, true);
                $ids = [];
                if (is_array($decoded) && isset($decoded['priorities']) && is_array($decoded['priorities'])) {
                    foreach ($decoded['priorities'] as $pr) {
                        if (is_array($pr) && isset($pr['id']) && dt_slug_ok((string) $pr['id'])) {
                            $ids[] = (string) $pr['id'];
                        }
                    }
                }
                $ids = array_values(array_unique($ids));
                if (count($ids) > 0) {
                    $fallback = in_array('medium', $ids, true) ? 'medium' : $ids[0];
                    $ph = implode(',', array_fill(0, count($ids), '?'));
                    $upd = $pdo->prepare("UPDATE tasks SET priority = ? WHERE priority NOT IN ({$ph})");
                    $upd->execute(array_merge([$fallback], $ids));
                }
            }
        }
    }
    if (array_key_exists('bucket_labels_json', $in)) {
        $v = $in['bucket_labels_json'];
        if ($v === null || $v === '') {
            $del->execute(['bucket_labels_json']);
        } elseif (is_string($v)) {
            $clean = sanitize_bucket_labels_json($v);
            if ($clean !== '') {
                $stmt->execute(['bucket_labels_json', $clean]);
            }
        }
    }
    if (array_key_exists('bucket_layout_json', $in)) {
        $v = $in['bucket_layout_json'];
        if ($v === null || $v === '') {
            $del->execute(['bucket_layout_json']);
            $pdo->exec("UPDATE tasks SET list_state = 'unassigned' WHERE list_state NOT IN ('unassigned','pending')");
        } elseif (is_string($v)) {
            $clean = sanitize_bucket_layout_json($v);
            if ($clean !== '') {
                $stmt->execute(['bucket_layout_json', $clean]);
                $decoded = json_decode($clean, true);
                $ids = [];
                if (is_array($decoded) && isset($decoded['buckets']) && is_array($decoded['buckets'])) {
                    foreach ($decoded['buckets'] as $br) {
                        if (is_array($br) && isset($br['id']) && dt_slug_ok((string) $br['id'])) {
                            $ids[] = (string) $br['id'];
                        }
                    }
                }
                $ids = array_values(array_unique($ids));
                if (count($ids) > 0) {
                    $fallback = in_array('unassigned', $ids, true) ? 'unassigned' : $ids[0];
                    $ph = implode(',', array_fill(0, count($ids), '?'));
                    $upd = $pdo->prepare("UPDATE tasks SET list_state = ? WHERE list_state NOT IN ({$ph})");
                    $upd->execute(array_merge([$fallback], $ids));
                }
            }
        }
    }
    if (array_key_exists('due_auto_priority_target', $in)) {
        $v = $in['due_auto_priority_target'];
        if ($v === null || $v === '') {
            $del->execute(['due_auto_priority_target']);
        } elseif (is_string($v) && dt_slug_ok($v)) {
            $rowsAfter = dt_app_settings_subset($pdo, ['priority_theme_json', 'priority_layout_json', 'bucket_labels_json', 'bucket_layout_json']);
            $layout = dt_task_layout_from_settings_rows($rowsAfter);
            if (dt_is_allowed_due_auto_target($v, $layout)) {
                $stmt->execute(['due_auto_priority_target', $v]);
            }
        }
    }
    if (array_key_exists('auto_priority_default_mode', $in)) {
        $m = (string) $in['auto_priority_default_mode'];
        if ($m === 'due_date' || $m === 'days') {
            $stmt->execute(['auto_priority_default_mode', $m]);
        }
    }
    if (array_key_exists('auto_priority_default_days_per_step', $in)) {
        $ds = (int) $in['auto_priority_default_days_per_step'];
        if ($ds < 1) {
            $ds = 1;
        }
        if ($ds > 365) {
            $ds = 365;
        }
        $stmt->execute(['auto_priority_default_days_per_step', (string) $ds]);
    }
    if (array_key_exists('ui_theme', $in)) {
        $uith = (string) $in['ui_theme'];
        if ($uith === 'light' || $uith === 'dark') {
            $stmt->execute(['ui_theme', $uith]);
        }
    }
    if (array_key_exists('weather_latitude', $in)) {
        $v = $in['weather_latitude'];
        if ($v === null || $v === '') {
            $del->execute(['weather_latitude']);
        } elseif (is_numeric($v)) {
            $lat = (float) $v;
            if ($lat >= -90 && $lat <= 90) {
                $stmt->execute(['weather_latitude', (string) $lat]);
            }
        }
    }
    if (array_key_exists('weather_longitude', $in)) {
        $v = $in['weather_longitude'];
        if ($v === null || $v === '') {
            $del->execute(['weather_longitude']);
        } elseif (is_numeric($v)) {
            $lon = (float) $v;
            if ($lon >= -180 && $lon <= 180) {
                $stmt->execute(['weather_longitude', (string) $lon]);
            }
        }
    }
    if (array_key_exists('weather_location_label', $in)) {
        $v = $in['weather_location_label'];
        if ($v === null || $v === '') {
            $del->execute(['weather_location_label']);
        } else {
            $label = trim((string) $v);
            if ($label !== '' && strlen($label) <= 200) {
                $stmt->execute(['weather_location_label', $label]);
            }
        }
    }
    if (array_key_exists('weather_temp_unit', $in)) {
        $u = strtoupper(trim((string) $in['weather_temp_unit']));
        $stmt->execute(['weather_temp_unit', ($u === 'F') ? 'F' : 'C']);
    }
    foreach (['schedule_hide_category_subcategory', 'schedule_hide_tags', 'mobile_schedule_glance'] as $schedHideKey) {
        if (!array_key_exists($schedHideKey, $in)) {
            continue;
        }
        $v = $in[$schedHideKey];
        $on = $v === true || $v === 1 || $v === '1' || $v === 'true';
        $stmt->execute([$schedHideKey, $on ? '1' : '0']);
    }
    if (array_key_exists('bulk_import_json', $in)) {
        $v = $in['bulk_import_json'];
        if ($v === null || $v === '') {
            $del->execute(['bulk_import_json']);
        } elseif (is_string($v)) {
            $decoded = json_decode($v, true);
            if (is_array($decoded)) {
                $clean = [
                    'delimiter' => in_array($decoded['delimiter'] ?? '', ['tab', 'comma', 'semicolon'], true)
                        ? $decoded['delimiter']
                        : 'tab',
                    'allow_duplicates_quick_add' => ($decoded['allow_duplicates_quick_add'] ?? true) !== false,
                    'add_new_values' => ($decoded['add_new_values'] ?? true) !== false,
                    'ignore_case' => ($decoded['ignore_case'] ?? false) === true,
                    'instruction_text' => isset($decoded['instruction_text']) ? mb_substr(trim((string) $decoded['instruction_text']), 0, 8000) : '',
                    'columns_enabled' => is_array($decoded['columns_enabled'] ?? null) ? $decoded['columns_enabled'] : [],
                ];
                $stmt->execute(['bulk_import_json', json_encode($clean)]);
            }
        }
    }
    if (array_key_exists('contact_link_json', $in)) {
        $v = $in['contact_link_json'];
        if ($v === null || $v === '') {
            $del->execute(['contact_link_json']);
        } elseif (is_string($v)) {
            $clean = sanitize_contact_link_json($v);
            if ($clean !== '') {
                $stmt->execute(['contact_link_json', $clean]);
            }
        }
    }

    $rowsFinal = dt_app_settings_subset($pdo, ['priority_theme_json', 'priority_layout_json', 'bucket_labels_json', 'bucket_layout_json', 'due_auto_priority_target']);
    $layoutFinal = dt_task_layout_from_settings_rows($rowsFinal);
    $dueVal = $rowsFinal['due_auto_priority_target'] ?? '';
    if ($dueVal !== '' && !dt_is_allowed_due_auto_target((string) $dueVal, $layoutFinal)) {
        $del->execute(['due_auto_priority_target']);
    }

    logMessage('INFO', 'settings PATCH ok');
    jsonResponse(['ok' => true]);
    exit;
}

logMessage('WARNING', 'settings method not allowed', ['method' => $method]);
jsonError('Method not allowed', 405);
