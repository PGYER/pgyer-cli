# Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create integration test suite using real filesystem and real PGYer API.

**Architecture:** Node.js built-in `node:test` + `node:assert`, tests run via `tsx`. Config backup/restore for isolation. Skip tests when `PGYER_API_KEY` not set.

**Tech Stack:** Node.js 18+, tsx, node:test, node:assert

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `test/setup.ts` | Create | Config backup/restore helpers |
| `test/config.test.ts` | Create | Config module tests |
| `test/auth.test.ts` | Create | Auth command tests |
| `test/apps.test.ts` | Create | Apps command tests |
| `test/upload.test.ts` | Create | Upload command tests |
| `package.json` | Modify | Add test script and tsx dependency |

---

### Task 1: Add Test Dependencies and Script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add tsx dependency and test script**

```json
{
  "scripts": {
    "test": "node --import tsx test/**/*.test.ts"
  },
  "devDependencies": {
    "@types/node": "^22.14.0",
    "tsup": "^8.4.0",
    "tsx": "^4.7.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Install dependency**

Run: `npm install`
Expected: tsx installed successfully

---

### Task 2: Create Test Setup Helpers

**Files:**
- Create: `test/setup.ts`

- [ ] **Step 1: Create setup.ts with config backup/restore**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Get config file path
 */
export function getConfigPath(): string {
  return path.join(os.homedir(), '.config', 'pgyer', 'config.json');
}

/**
 * Backup existing config and return backup content (or null if no config)
 */
export function backupConfig(): string | null {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    return fs.readFileSync(configPath, 'utf-8');
  }
  return null;
}

/**
 * Restore config from backup
 */
export function restoreConfig(backup: string | null): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  // Remove current config
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }

  // Restore backup if exists
  if (backup !== null) {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, backup, 'utf-8');
  }
}

/**
 * Clear config file
 */
export function clearConfig(): void {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/**
 * Save test config
 */
export function saveTestConfig(config: Record<string, unknown>): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Check if API key is available
 */
export function hasApiKey(): boolean {
  return !!process.env.PGYER_API_KEY;
}

/**
 * Get API key from environment
 */
export function getApiKey(): string | undefined {
  return process.env.PGYER_API_KEY;
}
```

---

### Task 3: Create Config Tests

**Files:**
- Create: `test/config.test.ts`

- [ ] **Step 1: Create config.test.ts**

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadFileConfig,
  saveConfig,
  clearConfig,
  loadConfig,
  getConfigPath,
} from '../src/core/config';
import { backupConfig, restoreConfig } from './setup';

describe('Config Module', () => {
  let backup: string | null;

  beforeEach(() => {
    backup = backupConfig();
    clearConfig();
  });

  afterEach(() => {
    restoreConfig(backup);
  });

  it('should load empty config when file does not exist', () => {
    clearConfig();
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
      if (originalEnv) {
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
```

- [ ] **Step 2: Run config tests**

Run: `npm test -- test/config.test.ts`
Expected: All 5 tests pass

---

### Task 4: Create Auth Tests

**Files:**
- Create: `test/auth.test.ts`

- [ ] **Step 1: Create auth.test.ts**

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import * as path from 'path';
import { backupConfig, restoreConfig, hasApiKey, saveTestConfig } from './setup';

const CLI_PATH = path.resolve(__dirname, '../src/index.ts');

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', CLI_PATH, ...args], {
      shell: true,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

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
      clearConfig();
      const result = await runCli(['auth', 'status', '--json']);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.loggedIn, false);
    });

    it('should show logged in via API when PGYER_API_KEY is set', async function () {
      if (!hasApiKey()) {
        this.skip();
        return;
      }

      clearConfig();
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

      const result = await runCli(['auth', 'status', '--json']);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.loggedIn, true);
      assert.strictEqual(output.user, 'test-user');
    });
  });

  describe('auth token', () => {
    it('should show token from config', async () => {
      saveTestConfig({ apiKey: 'my-test-token' });

      const result = await runCli(['auth', 'token', '--json']);

      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.token, 'my-test-token');
    });

    it('should show error when no token', async () => {
      clearConfig();

      const result = await runCli(['auth', 'token', '--json']);

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

      await runCli(['auth', 'logout']);

      const result = await runCli(['auth', 'status', '--json']);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.loggedIn, false);
    });
  });
});

// Import clearConfig after function definitions to avoid hoisting issues
function clearConfig() {
  const configPath = path.join(
    require('os').homedir(),
    '.config',
    'pgyer',
    'config.json'
  );
  if (require('fs').existsSync(configPath)) {
    require('fs').unlinkSync(configPath);
  }
}
```

- [ ] **Step 2: Run auth tests**

Run: `npm test -- test/auth.test.ts`
Expected: All tests pass (some may skip if no API key)

---

### Task 5: Create Apps Tests

**Files:**
- Create: `test/apps.test.ts`

- [ ] **Step 1: Create apps.test.ts**

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import * as path from 'path';
import { backupConfig, restoreConfig, hasApiKey } from './setup';

const CLI_PATH = path.resolve(__dirname, '../src/index.ts');

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(args: string[], env?: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', CLI_PATH, ...args], {
      shell: true,
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

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

    it('should list apps with valid API key', async function () {
      if (!hasApiKey()) {
        this.skip();
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
    it('should fail without appKey', async () => {
      const result = await runCli(['apps', 'info']);

      assert.notStrictEqual(result.code, 0);
    });

    it('should show app info with valid appKey', async function () {
      if (!hasApiKey()) {
        this.skip();
        return;
      }

      // First get an appKey from list
      const listResult = await runCli(['apps', 'list', '--json']);
      const listOutput = JSON.parse(listResult.stdout);

      if (!listOutput.apps || listOutput.apps.length === 0) {
        this.skip();
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
    it('should fail without appKey', async () => {
      const result = await runCli(['apps', 'delete']);

      assert.notStrictEqual(result.code, 0);
    });

    it('should delete app with --force', async function () {
      if (!hasApiKey()) {
        this.skip();
        return;
      }

      // This test requires a disposable app
      // For safety, we skip this test unless explicitly enabled
      if (!process.env.TEST_DELETE_APP) {
        this.skip();
        return;
      }

      const appKey = process.env.TEST_DELETE_APP;

      const result = await runCli(['apps', 'delete', appKey, '--force', '--json']);

      assert.strictEqual(result.code, 0);
    });
  });
});
```

- [ ] **Step 2: Run apps tests**

Run: `npm test -- test/apps.test.ts`
Expected: Tests pass or skip appropriately

---

### Task 6: Create Upload Tests

**Files:**
- Create: `test/upload.test.ts`

- [ ] **Step 1: Create upload.test.ts**

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { backupConfig, restoreConfig, hasApiKey } from './setup';

const CLI_PATH = path.resolve(__dirname, '../src/index.ts');

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(args: string[], env?: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', CLI_PATH, ...args], {
      shell: true,
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

function getTestFilePath(): string | null {
  // Check for test file in environment or common locations
  const envPath = process.env.TEST_APK_PATH || process.env.TEST_IPA_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // Check test fixtures directory
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
    assert.ok(result.stderr.includes('Error:') || result.stdout.includes('Error:'));
  });

  it('should fail without API key', async () => {
    const result = await runCli(
      ['upload', '/tmp/test.apk', '--json'],
      { PGYER_API_KEY: '' }
    );

    assert.notStrictEqual(result.code, 0);
  });

  it('should reject --password and --invite-install together', async function () {
    if (!hasApiKey()) {
      this.skip();
      return;
    }

    const testFile = getTestFilePath();
    if (!testFile) {
      this.skip();
      return;
    }

    const result = await runCli([
      'upload',
      testFile,
      '--password',
      '123456',
      '--invite-install',
      '--json',
    ]);

    assert.notStrictEqual(result.code, 0);
  });

  it('should upload file successfully', async function () {
    if (!hasApiKey()) {
      this.skip();
      return;
    }

    const testFile = getTestFilePath();
    if (!testFile) {
      this.skip();
      return;
    }

    const result = await runCli(['upload', testFile, '--json']);

    assert.strictEqual(result.code, 0);

    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.success, true);
    assert.ok(output.buildKey);
    assert.ok(output.buildVersion);
  });

  it('should upload with build description', async function () {
    if (!hasApiKey()) {
      this.skip();
      return;
    }

    const testFile = getTestFilePath();
    if (!testFile) {
      this.skip();
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

  it('should upload with password', async function () {
    if (!hasApiKey()) {
      this.skip();
      return;
    }

    const testFile = getTestFilePath();
    if (!testFile) {
      this.skip();
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

  it('should validate pubstart/pubend together', async function () {
    if (!hasApiKey()) {
      this.skip();
      return;
    }

    const testFile = getTestFilePath();
    if (!testFile) {
      this.skip();
      return;
    }

    // Only pubstart, should fail
    const result = await runCli([
      'upload',
      testFile,
      '--pubstart',
      '2024-01-01',
      '--json',
    ]);

    assert.notStrictEqual(result.code, 0);
  });
});
```

- [ ] **Step 2: Run upload tests**

Run: `npm test -- test/upload.test.ts`
Expected: Tests pass or skip if no test file/API key

---

### Task 7: Run All Tests

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: All tests pass or skip appropriately based on environment

- [ ] **Step 2: Verify test summary**

Expected output shows:
- Config tests: 5 passed
- Auth tests: passed (some may skip)
- Apps tests: passed (some may skip)
- Upload tests: passed (most will skip without test file)
