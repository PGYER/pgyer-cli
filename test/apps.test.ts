import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { backupConfig, restoreConfig, hasApiKey, runCli } from './setup';

describe('Apps Commands', () => {
  let backup: string | null;

  before(() => {
    backup = backupConfig();
  });

  after(() => {
    restoreConfig(backup);
  });

  describe('apps list', () => {
    it('should fail without API key', async () => {
      const result = await runCli(['apps', 'list', '--json'], {
        PGYER_API_KEY: '',
      });

      assert.notStrictEqual(result.code, 0);
    });

    it('should list apps with valid API key', async (t) => {
      if (!hasApiKey()) {
        t.skip('PGYER_API_KEY not set');
        return;
      }

      const result = await runCli(['apps', 'list', '--json']);

      assert.strictEqual(result.code, 0);

      const output = JSON.parse(result.stdout);
      assert.ok(Array.isArray(output.apps));

      if (output.apps.length > 0) {
        const app = output.apps[0];
        assert.ok(app.name);
        assert.ok(app.appKey);
      }
    });
  });

  describe('apps info', () => {
    it('should fail without appKey argument', async () => {
      const result = await runCli(['apps', 'info']);

      assert.notStrictEqual(result.code, 0);
    });

    it('should show app info with valid appKey', async (t) => {
      if (!hasApiKey()) {
        t.skip('PGYER_API_KEY not set');
        return;
      }

      // First get an appKey from list
      const listResult = await runCli(['apps', 'list', '--json']);
      const listOutput = JSON.parse(listResult.stdout);

      if (!listOutput.apps || listOutput.apps.length === 0) {
        t.skip('No apps available');
        return;
      }

      const appKey = listOutput.apps[0].appKey;
      const result = await runCli(['apps', 'info', appKey, '--json']);

      assert.strictEqual(result.code, 0);

      const output = JSON.parse(result.stdout);
      assert.ok(output.appKey);
    });
  });

  describe('apps delete', () => {
    it('should fail without appKey argument', async () => {
      const result = await runCli(['apps', 'delete']);

      assert.notStrictEqual(result.code, 0);
    });

    it('should delete app with --force (requires TEST_DELETE_APP env)', async (t) => {
      if (!hasApiKey()) {
        t.skip('PGYER_API_KEY not set');
        return;
      }

      if (!process.env.TEST_DELETE_APP) {
        t.skip('TEST_DELETE_APP not set');
        return;
      }

      const appKey = process.env.TEST_DELETE_APP;
      const result = await runCli(['apps', 'delete', appKey, '--force', '--json']);

      assert.strictEqual(result.code, 0);
    });
  });
});
