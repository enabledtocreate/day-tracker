<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/lib/sso.php';

final class SsoStateTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        putenv('DAYTRACKER_TEST=1');
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'daytracker_sso_state_' . getmypid();
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        putenv('DAYTRACKER_TEST_DATA_DIR=' . $dir);
    }

    protected function tearDown(): void
    {
        putenv('DAYTRACKER_TEST');
        putenv('DAYTRACKER_TEST_DATA_DIR');
        parent::tearDown();
    }

    public function testOAuthStateRoundTripGoogleAndOutlook(): void
    {
        $g = ssoEncodeState('google');
        $this->assertNotSame('', $g);
        $this->assertSame('google', ssoDecodeState($g));

        $o = ssoEncodeState('outlook');
        $this->assertSame('outlook', ssoDecodeState($o));
    }

    public function testOAuthStateInvalidReturnsNull(): void
    {
        $this->assertNull(ssoDecodeState(null));
        $this->assertNull(ssoDecodeState(''));
        $this->assertNull(ssoDecodeState('not-valid-base64!!!'));
    }
}
