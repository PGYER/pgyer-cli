# @pgyer/cli

A command-line tool for PGYER App Distribution Platform, supporting app uploads, management, and account authentication.

## Installation

```bash
# Global installation
npm install -g @pgyer/cli

# Or use directly via npx
npx @pgyer/cli
```

Requires Node.js >= 18.0.0.

## Quick Start

```bash
# Login to account
pgyer auth login

# Upload app
pgyer upload ./app-release.apk

# View app list
pgyer apps list
```

## Output Modes

The tool supports two output modes, adapting to different use cases.

### Auto Mode (Default)

When neither `--human` nor `--json` is specified, the tool automatically selects the output mode based on the runtime environment:

- **Terminal (TTY)** — Automatically enables Human mode with colors, animations and tables
- **Pipe/Script/CI** — Automatically enables JSON mode with pure structured data output

```bash
# Running directly in terminal → Human mode
pgyer apps list

# Running in pipeline → JSON mode
pgyer apps list | jq '.apps[0].name'
```

### `--human` / `-H` Mode

Force human-friendly output, suitable for interactive use:

- Colored text and status icons (`✔` `✖` `ℹ`)
- Loading animation (spinner)
- Aligned table display

```bash
$ pgyer apps list --human
✔ Found 2 apps

name    │ bundleId            │ version │ appKey │ type │ size    │ createdAt
────────┼─────────────────────┼─────────┼────────┼──────┼─────────┼─────────────────────
MyApp   │ com.example.app     │ 1.0.0   │ abc123 │ iOS  │ 11.8 MB │ 2024-01-01 00:00:00

$ pgyer auth status --human
✔ Logged in as username <uKey>
```

### `--json` Mode

Force JSON output, suitable for script parsing and LLM invocation:

- No colors, no animations, no formatting
- Structured JSON data output to stdout
- Error messages output to stderr with `Error:` prefix

```bash
$ pgyer apps list --json
{"apps":[{"name":"MyApp","bundleId":"com.example.app","version":"1.0.0","appKey":"abc123","type":"iOS","size":"11.8 MB","createdAt":"2024-01-01 00:00:00"}]}

$ pgyer auth status --json
{"loggedIn":true,"user":"username"}
```

### Priority

`--human` > `--json` > TTY auto-detection

When both `--human` and `--json` are specified, `--human` takes precedence.

## Command Reference

### `pgyer auth login`

Login via browser authorization. Automatically starts a local callback server, opens a browser to complete authorization, and saves credentials to the config file.

```bash
pgyer auth login
```

### `pgyer auth logout`

Clear locally stored login credentials while preserving other configuration items.

```bash
pgyer auth logout
```

### `pgyer auth status`

Check current login status.

```bash
$ pgyer auth status
{"loggedIn":true,"user":"username"}

$ pgyer auth status --human
✔ Logged in as username <uKey>
```

If authenticated via the `PGYER_API_KEY` environment variable, it will display "Logged in via API".

### `pgyer auth token`

Display the current API Token.

```bash
$ pgyer auth token
{"token":"your-api-key-here"}

$ pgyer auth token --human
API Token: your-api-key-here
```

### `pgyer apps list`

List all apps under the current account.

```bash
pgyer apps list
```

### `pgyer apps info <appKey>`

View detailed information about a specific app.

```bash
$ pgyer apps info abc123 --human
App: MyApp (com.example.app)
  App Key:     abc123
  Version:     1.0.0 (Build 1)
  Platform:    Android
  Size:        10.0 MB
  Shortcut:    abc
  Install:     Public
  Created:     2024-01-01 00:00:00
  Updated:     2024-01-01 00:00:00
  Expires:     2025-01-01 00:00:00
```

### `pgyer apps delete <appKey>`

Delete a specified app. In Human mode, it will request confirmation; use `--force` to skip.

```bash
pgyer apps delete abc123
pgyer apps delete abc123 --force
```

### `pgyer upload <file>`

Upload IPA, APK or HAP installation packages.

```bash
pgyer upload ./app-release.apk
```

**Options:**

| Option | Description |
|--------|-------------|
| `--app-key <key>` | Specify target app (auto-match if not specified) |
| `--build-update-description <desc>` | Version update description |
| `--password <pwd>` | Installation password (set for password installation) |
| `--invite-install` | Set as invite-only installation (cannot be used with `--password`) |
| `--pubstart <date>` | Installation validity start date (YYYY-MM-DD) |
| `--pubend <date>` | Installation validity end date (YYYY-MM-DD) |
| `--short <shortcut>` | Channel short link |

**Examples:**

```bash
# Upload and set password installation
pgyer upload ./app.apk --password 123456

# Upload and specify validity period
pgyer upload ./app.ipa --pubstart 2024-01-01 --pubend 2024-12-31

# Upload and set update description
pgyer upload ./app.apk --build-update-description "Fixed known issues"
```

> `--pubstart` and `--pubend` must be used together, and the end date must be greater than the start date.

## Configuration

### Priority

CLI arguments > Environment variables > Config file

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PGYER_API_KEY` | API Key, can be used instead of `auth login` for authentication |
| `PGYER_OUTPUT_FORMAT` | Output format, `json` or `text` |

```bash
# Use environment variable authentication in CI environment
export PGYER_API_KEY=your-api-key
pgyer upload ./app.apk
```

### Config File

Path: `~/.config/pgyer/config.json`

```json
{
  "apiKey": "xxx",
  "apiUrl": "https://api.pgyer.com",
  "outputFormat": "json"
}
```

Config file permissions are automatically set to `600` (readable and writable by owner only).

## License

MIT
