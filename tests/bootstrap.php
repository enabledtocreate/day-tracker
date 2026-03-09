<?php
/**
 * PHPUnit bootstrap: add project root to include path; set test env; load TestHelper.
 * DBs are not created here—tests that need them call createTestEnvironment() or TestHelper helpers.
 */
$root = dirname(__DIR__);
set_include_path($root . PATH_SEPARATOR . get_include_path());

putenv('DAYTRACKER_TEST=1');

require_once __DIR__ . '/TestHelper.php';
