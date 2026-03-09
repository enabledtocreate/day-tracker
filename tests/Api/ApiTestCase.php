<?php
/**
 * Base class for API tests: test env (temp dir, master + user DB, session), request() helper.
 * Run this testsuite with process isolation so getPdo()/getMasterPdo() statics don't leak.
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
        $apiDir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'api';
        $scriptPath = $apiDir . DIRECTORY_SEPARATOR . $scriptName;
        if (!is_file($scriptPath)) {
            throw new \InvalidArgumentException('API script not found: ' . $scriptPath);
        }

        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['REQUEST_URI'] = '/api/' . $scriptName . ($query ? '?' . http_build_query($query) : '');
        $_GET = $query;
        $_POST = [];

        $GLOBALS['_DAYTRACKER_TEST_RAW_INPUT'] = null;
        if ($body !== null && in_array($method, ['POST', 'PATCH', 'PUT'], true)) {
            $GLOBALS['_DAYTRACKER_TEST_RAW_INPUT'] = is_string($body) ? $body : json_encode($body);
        }

        ob_start();
        $code = 200;
        try {
            require $scriptPath;
        } catch (\Throwable $e) {
            $code = http_response_code() ?: 500;
            if (ob_get_length()) {
                ob_end_flush();
            } else {
                ob_end_clean();
            }
            throw $e;
        }
        $output = ob_get_clean();
        $code = http_response_code() ?: $code;

        $decoded = @json_decode($output, true);
        return [
            'body' => $decoded !== null ? $decoded : $output,
            'code' => $code,
        ];
    }
}
