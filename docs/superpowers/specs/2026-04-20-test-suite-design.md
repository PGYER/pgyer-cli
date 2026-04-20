# Test Suite Design

Date: 2026-04-20

## Overview

Integration test suite for pgyer-cli using real filesystem and real PGYer API calls.

## Test Framework

- **Framework**: Node.js built-in `node:test` + `node:assert`
- **No external test dependencies required**
- **Runner**: `npm test` via `ts-node`

## Test Requirements

### Environment
- `PGYER_API_KEY` environment variable must be set (tests skip if missing)
- Tests use real `~/.config/pgyer/config.json`

### Test Assets
- Sample APK/IPA file for upload tests (optional, skip if not provided)

## Test Categories

### 1. Config Tests (`test/config.test.ts`)

Test the config module with real filesystem:

| Test | Description |
|------|-------------|
| Load config | Load existing config file |
| Save config | Save new config values |
| Clear config | Remove config file |
| Config priority | Verify CLI > env > file priority |

**Setup**: Backup existing config before test, restore after.

### 2. Auth Tests (`test/auth.test.ts`)

Test auth commands (excluding `login`):

| Test | Description |
|------|-------------|
| `auth status` | Check login status |
| `auth token` | Display API token |
| `auth logout` | Clear saved credentials |

**Requires**: `PGYER_API_KEY` set

### 3. Apps Tests (`test/apps.test.ts`)

Test apps commands with real API:

| Test | Description |
|------|-------------|
| `apps list` | List all apps |
| `apps info <appKey>` | Get app details |
| `apps delete <appKey> --force` | Delete an app |

**Requires**: `PGYER_API_KEY` set
**Note**: Delete test requires a disposable app (skip if none available)

### 4. Upload Tests (`test/upload.test.ts`)

Test upload command with real API:

| Test | Description |
|------|-------------|
| Upload APK | Upload an APK file |
| Upload with options | Upload with description, password, etc. |

**Requires**: `PGYER_API_KEY` + test APK/IPA file
**Note**: Skip if no test file available

## Directory Structure

```
test/
├── setup.ts           # Config backup/restore helpers
├── config.test.ts     # Config module tests
├── auth.test.ts       # Auth command tests
├── apps.test.ts       # Apps command tests
└── upload.test.ts     # Upload command tests
```

## Package.json Changes

Add test script:
```json
{
  "scripts": {
    "test": "node --import tsx test/**/*.test.ts"
  },
  "devDependencies": {
    "tsx": "^4.7.0"
  }
}
```

## Test Isolation

### Config Backup Strategy

```typescript
// Before test
const backup = readConfigIfExists()
saveTestConfig(testConfig)

// After test
if (backup) restoreConfig(backup)
else deleteConfig()
```

### Test Execution Order

Tests run in parallel by default. Config tests need isolation (serial execution) to avoid race conditions.

## Error Handling

- Skip tests if `PGYER_API_KEY` not set
- Skip upload tests if no test file provided
- Fail clearly if API returns errors
