<?php
/**
 * Tests for demo account helpers (lib/demo_seed.php).
 */
use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__) . '/lib/demo_seed.php';

final class DemoSeedTest extends TestCase
{
    public function testIsDemoUserReturnsTrueForDemoUsername(): void
    {
        $this->assertTrue(isDemoUser(['username' => 'demo']));
    }

    public function testIsDemoUserReturnsFalseForOtherUsername(): void
    {
        $this->assertFalse(isDemoUser(['username' => 'alice']));
    }

    public function testIsDemoUserReturnsFalseWhenUsernameMissing(): void
    {
        $this->assertFalse(isDemoUser(['id' => 1]));
    }

    public function testGetDemoUserIdReturnsNullWhenNoDemoUser(): void
    {
        $master = new PDO('sqlite::memory:');
        $master->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
        $master->exec("INSERT INTO users (username) VALUES ('alice')");
        $this->assertNull(getDemoUserId($master));
    }

    public function testGetDemoUserIdReturnsIdWhenDemoUserExists(): void
    {
        $master = new PDO('sqlite::memory:');
        $master->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)');
        $master->exec("INSERT INTO users (username) VALUES ('alice')");
        $master->exec("INSERT INTO users (username) VALUES ('demo')");
        $this->assertSame(2, getDemoUserId($master));
    }
}
