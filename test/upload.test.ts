import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { backupConfig, restoreConfig, clearTestConfig, hasApiKey, runCli } from './setup';

function getTestFilePath(): string | null {
  const envPath = process.env.TEST_APK_PATH || process.env.TEST_IPA_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const fixturesDir = path.resolve(__dirname, 'fixtures');
  if (fs.existsSync(fixturesDir)) {
    const files = fs.readdirSync(fixturesDir);
    const apk = files.find((f) => f.endsWith('.apk'));
    const ipa = files.find((f) => f.endsWith('.ipa'));
    if (apk) return path.join(fixturesDir, apk);
    if (ipa) return path.join(fixturesDir, ipa);
  }

  return null;
}

describe('Upload Command', () => {
  let backup: string | null;

  before(() => {
    backup = backupConfig();
  });

  after(() => {
    restoreConfig(backup);
  });

  it('should fail without file argument', async () => {
    const result = await runCli(['upload']);

    assert.notStrictEqual(result.code, 0);
  });

  it('should fail with non-existent file', async () => {
    const result = await runCli(['upload', '/nonexistent/file.apk', '--json']);

    assert.notStrictEqual(result.code, 0);
    const output = JSON.parse(result.stderr);
    assert.strictEqual(output.error.code, 'FILE_NOT_FOUND');
  });

  it('should fail without API key', async () => {
    clearTestConfig();
    // Create a temporary file for this test
    const tmpFile = path.resolve(__dirname, 'tmp-test-file.apk');
    fs.writeFileSync(tmpFile, 'dummy content');

    try {
      const result = await runCli(
        ['upload', tmpFile, '--json'],
        { PGYER_API_KEY: '' }
      );

      assert.notStrictEqual(result.code, 0);
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  it('should reject --password and --invite-install together', async () => {
    const result = await runCli([
      'upload',
      '/nonexistent/validation.apk',
      '--password',
      '123456',
      '--invite-install',
      '--json',
    ]);

    assert.notStrictEqual(result.code, 0);
    assert.match(result.stderr, /cannot be used together/);
  });

  it('should validate pubstart/pubend must be used together', async () => {
    // Only pubstart, should fail
    const result = await runCli([
      'upload',
      '/nonexistent/validation.apk',
      '--pubstart',
      '2024-01-01',
      '--json',
    ]);

    assert.notStrictEqual(result.code, 0);
    assert.match(result.stderr, /must be used together/);
  });

  it('should upload file successfully', async (t) => {
    if (!hasApiKey()) {
      t.skip('PGYER_API_KEY not set');
      return;
    }

    const testFile = getTestFilePath();
    if (!testFile) {
      t.skip('No test file available');
      return;
    }

    const result = await runCli(['upload', testFile, '--json']);

    assert.strictEqual(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.success, true);
    assert.ok(output.buildKey);
    assert.ok(output.buildVersion);
  });

  it('should upload with build description', async (t) => {
    if (!hasApiKey()) {
      t.skip('PGYER_API_KEY not set');
      return;
    }

    const testFile = getTestFilePath();
    if (!testFile) {
      t.skip('No test file available');
      return;
    }

    const result = await runCli([
      'upload',
      testFile,
      '--build-update-description',
      'Test upload from CLI',
      '--json',
    ]);

    assert.strictEqual(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.success, true);
  });

  it('should upload with password', async (t) => {
    if (!hasApiKey()) {
      t.skip('PGYER_API_KEY not set');
      return;
    }

    const testFile = getTestFilePath();
    if (!testFile) {
      t.skip('No test file available');
      return;
    }

    const result = await runCli([
      'upload',
      testFile,
      '--password',
      '123456',
      '--json',
    ]);

    assert.strictEqual(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.success, true);
  });
});
