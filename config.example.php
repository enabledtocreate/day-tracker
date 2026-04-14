<?php
/**
 * Copy to config.php and set your values.
 * config.php is not in version control.
 */
return [
    'data_dir' => __DIR__ . '/data',
    'master_db_path' => __DIR__ . '/data/daytracker_master.sqlite',
    // Optional: public site URL with scheme, no trailing slash. Use when the app lives in a subfolder
    // or behind a reverse proxy so OAuth redirect_uri matches provider console settings exactly.
    // Example: 'https://example.com/DayTracker'
    'base_url' => '',
    'openai_api_key' => '', // Your OpenAI API key for ChatGPT integration
    'google_client_id' => '',
    'google_client_secret' => '',
    'outlook_client_id' => '',
    'outlook_client_secret' => '',
];
