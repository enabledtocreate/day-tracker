<?php
/**
 * Base class for API tests: temp dir, master + user DB, and request() via subprocess
 * (tests/api_request_harness.php) so api/*.php can call exit without stopping PHPUnit.
 */

use PHPUnit\Framework\TestCase;

abstract class ApiTestCase extends TestCase {

    /** @var string */
    protected $dataDir;

    /** @var array */
    protected $testUser;

    protected function setUp(): void {
        parent::setUp();
        $env = createTestEnvironment();
        $this->dataDir = $env['dataDir'];
        $this->testUser = $env['user'];
    }

    protected function tearDown(): void {
        if (isset($this->dataDir) && is_dir($this->dataDir)) {
            $files = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($this->dataDir, \RecursiveDirectoryIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($files as $file) {
                $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
            }
            rmdir($this->dataDir);
        }
        putenv('DAYTRACKER_TEST_DATA_DIR');
        parent::tearDown();
    }

    /**
     * Perform a request to an API script and return response body and status code.
     *
     * @param string $method GET, POST, PATCH, DELETE
     * @param string $uri Script name without path, e.g. "tasks", "day", "settings"
     * @param array $query Query string params (e.g. ['date' => '2025-01-01'])
     * @param mixed $body For POST/PATCH: array (encoded as JSON) or string
     * @return array{body: mixed, code: int} body is decoded JSON or raw string; code is HTTP status
     */
    protected function request(string $method, string $uri, array $query = [], $body = null): array {
        $scriptName = str_ends_with($uri, '.php') ? $uri : $uri . '.php';
        $root = dirname(__DIR__, 2);
        $scriptPath = $root . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . $scriptName;
        if (!is_file($scriptPath)) {
            throw new \InvalidArgumentException('API script not found: ' . $scriptPath);
        }

        return runApiRequestHarness($this->dataDir, $this->testUser, $scriptName, $method, $query, $body);
    }
}
