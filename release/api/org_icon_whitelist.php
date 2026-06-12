<?php
/**
 * Lucide kebab-case icon names allowed for task_categories.icon and task_blocks.icon.
 * Data file: org_icon_whitelist.json (regenerate with `npm run gen:org-icons` from lucide-react).
 */
$path = __DIR__ . '/org_icon_whitelist.json';
if (!is_readable($path)) {
    return [];
}
$decoded = json_decode((string) file_get_contents($path), true);
return is_array($decoded) ? $decoded : [];
