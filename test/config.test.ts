import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import {
  loadFileConfig,
  saveConfig,
  clearConfig,
  loadConfig,
  getConfigPath,
} from '../src/core/config';
import { backupConfig, restoreConfig, clearTestConfig } from './setup';

describe('Config Module', () => {
  let backup: string | null;

  beforeEach(() => {
    backup = backupConfig();
    clearTestConfig();
  });

  afterEach(() => {
    restoreConfig(backup);
  });

  it('should load empty config when file does not exist', () => {
    clearTestConfig();
    const config = loadFileConfig();
    assert.deepStrictEqual(config, {});
  });

  it('should save and load config', () => {
    const testConfig = {
      apiKey: 'test-api-key',
      apiUrl: 'https://api.pgyer.com',
      outputFormat: 'json' as const,
    };

    saveConfig(testConfig);
    const loaded = loadFileConfig();

    assert.strictEqual(loaded.apiKey, testConfig.apiKey);
    assert.strictEqual(loaded.apiUrl, testConfig.apiUrl);
    assert.strictEqual(loaded.outputFormat, testConfig.outputFormat);
  });

  it('should clear config file', () => {
    saveConfig({ apiKey: 'test-key' });

    const configPath = getConfigPath();
    assert.ok(fs.existsSync(configPath));

    clearConfig();
    assert.ok(!fs.existsSync(configPath));
  });

  it('should merge config with priority: CLI > env > file', () => {
    // Save file config
    saveConfig({
      apiKey: 'file-key',
      outputFormat: 'json',
    });

    // Set env var
    const originalEnv = process.env.PGYER_API_KEY;
    process.env.PGYER_API_KEY = 'env-key';

    try {
      // CLI config should override all
      const config = loadConfig({ apiKey: 'cli-key' });
      assert.strictEqual(config.apiKey, 'cli-key');

      // Without CLI, env should override file
      const config2 = loadConfig();
      assert.strictEqual(config2.apiKey, 'env-key');
    } finally {
      if (originalEnv !== undefined) {
        process.env.PGYER_API_KEY = originalEnv;
      } else {
        delete process.env.PGYER_API_KEY;
      }
    }
  });

  it('should set file permissions to 600', () => {
    saveConfig({ apiKey: 'test-key' });

    const configPath = getConfigPath();
    const stats = fs.statSync(configPath);
    const mode = stats.mode & 0o777;

    assert.strictEqual(mode, 0o600, 'Config file should have 600 permissions');
  });
});
