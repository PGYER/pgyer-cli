import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  backupConfig,
  restoreConfig,
  clearTestConfig,
  saveTestConfig,
  hasApiKey,
  runCli,
} from './setup';

describe('Auth Commands', () => {
  let backup: string | null;

  beforeEach(() => {
    backup = backupConfig();
  });

  afterEach(() => {
    restoreConfig(backup);
  });

  describe('auth status', () => {
    it('should show not logged in when no credentials', async () => {
      clearTestConfig();
      // Must also clear env var to avoid env-based auth detection
      const result = await runCli(['auth', 'status', '--json'], { PGYER_API_KEY: '' });

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.loggedIn, false);
    });

    it('should show logged in via env when PGYER_API_KEY is set', async (t) => {
      if (!hasApiKey()) {
        t.skip('PGYER_API_KEY not set');
        return;
      }

      clearTestConfig();
      const result = await runCli(['auth', 'status', '--json']);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.loggedIn, true);
    });

    it('should show logged in with user info when config has apiKey', async () => {
      saveTestConfig({
        apiKey: 'test-key',
        ukey: 'test-ukey',
        name: 'test-user',
      });

      // Clear env to ensure we're testing file-based auth
      const result = await runCli(['auth', 'status', '--json'], { PGYER_API_KEY: '' });

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.loggedIn, true);
      assert.strictEqual(output.user, 'test-user');
    });
  });

  describe('auth token', () => {
    it('should show token from config', async () => {
      saveTestConfig({ apiKey: 'my-test-token' });

      // Clear env to ensure reading from config file
      const result = await runCli(['auth', 'token', '--json'], { PGYER_API_KEY: '' });

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.token, 'my-test-token');
    });

    it('should show error when no token', async () => {
      clearTestConfig();
      // Also write empty config to ensure no apiKey even if clearTestConfig fails
      saveTestConfig({});
      // Must clear env PGYER_API_KEY too
      const result = await runCli(['auth', 'token', '--json'], { PGYER_API_KEY: '' });

      assert.notStrictEqual(result.code, 0);
    });
  });

  describe('auth logout', () => {
    it('should clear credentials', async () => {
      saveTestConfig({
        apiKey: 'test-key',
        ukey: 'test-ukey',
        name: 'test-user',
      });

      await runCli(['auth', 'logout'], { PGYER_API_KEY: '' });

      const result = await runCli(['auth', 'status', '--json'], { PGYER_API_KEY: '' });
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.loggedIn, false);
    });
  });
});
