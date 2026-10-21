# @pgyer/cli

[简体中文](./README.md) | English

A modern command-line client for the [PGYER](https://www.pgyer.com/) app
distribution platform. Upload IPA, APK, and HAP packages through the API 2.0
fast-upload flow, manage apps and historical builds, and integrate releases
into CI or AI-agent workflows. A built-in MCP server (`pgyer mcp`) lets AI
clients such as Claude, Cursor, VS Code and Codex use PGYER directly.

## Highlights

- API 2.0 fast uploads with streamed file transfer
- IPA, APK, and HAP package support
- Domestic, overseas, and automatic upload-region selection
- Synchronous uploads or asynchronous status tracking
- App discovery, settings management, and safe deletion workflows
- Historical build listing, update checks, latest-version controls, and deletion
- Readable output by default, with explicit JSON for automation
- Non-interactive safeguards, `--dry-run`, redacted credentials, and stable errors
- Built-in MCP server for AI clients
- Automatic fallback to backup PGYER domains when the main one is unreachable

## Requirements

- Node.js 20.19 or later
- A PGYER account or API Key

## Installation

Install the CLI globally:

```bash
npm install --global @pgyer/cli
```

Or run it without installing:

```bash
npx @pgyer/cli --help
```

## Quick Start

```bash
# Authenticate in the browser
pgyer auth login

# Confirm the active account
pgyer auth status

# Upload and wait until PGYER finishes processing
pgyer upload ./app-release.apk

# Inspect apps and historical builds
pgyer apps list
pgyer versions list <appKey>
```

For CI, provide the API Key without starting browser login:

```bash
export PGYER_API_KEY="your-api-key"
pgyer upload ./app-release.apk --json
```

## Fast Upload

`pgyer upload` uses the PGYER API 2.0 fast-upload flow. The CLI requests upload
credentials, streams the package directly to object storage, and waits for
PGYER to publish the build unless `--no-wait` is specified.

```bash
# Upload with automatic region selection
pgyer upload ./app.apk

# Upload within mainland China and wait up to 15 minutes for processing
pgyer upload ./app.hap --upload-region domestic --timeout 900

# Add release notes
pgyer upload ./app.ipa \
  --build-update-description "Fix startup performance and known issues"
```

### Installation controls

Avoid placing installation passwords directly in shell history. The bare
`--password-env` option reads `PGYER_INSTALL_PASSWORD`; a custom variable name
can also be supplied.

```bash
export PGYER_INSTALL_PASSWORD="replace-with-a-secret"
pgyer upload ./app.apk --password-env

export RELEASE_INSTALL_PASSWORD="replace-with-a-secret"
pgyer upload ./app.apk --password-env RELEASE_INSTALL_PASSWORD

pgyer upload ./app.apk --invite-install
pgyer upload ./app.apk --install-type public
pgyer upload ./app.ipa --pubstart 2026-08-01 --pubend 2026-12-31
```

`--pubstart` and `--pubend` must be used together, and the end date must be
later than the start date.

An upload sends only the settings you give. Without `--install-type`,
`--password` or `--invite-install`, the app keeps its current install type
(0.1.x reset it to public); use `--install-type public` to make it public.

### Upload options

| Option | Description |
| --- | --- |
| `--description <text>` | Set the app description |
| `--build-update-description <text>` | Set release notes for this build |
| `--install-type <type>` | `public`, `password` or `invite`; by default the app keeps its current setting |
| `--password <password>` | Use password-protected installation |
| `--password-env [name]` | Read the password from an environment variable; defaults to `PGYER_INSTALL_PASSWORD` |
| `--invite-install` | Restrict installation to invited users |
| `--pubstart <YYYY-MM-DD>` | Set the installation-validity start date |
| `--pubend <YYYY-MM-DD>` | Set the installation-validity end date |
| `--short <shortcut>` | Set a channel shortcut |
| `--upload-region <region>` | Select `auto`, `domestic`, or `overseas`; defaults to `auto` |
| `--timeout <seconds>` | How long to wait for PGYER to process the build after the file is uploaded; defaults to `600` |
| `--poll-interval <seconds>` | Set the build-processing poll interval; defaults to `3` |
| `--no-wait` | Return after storage upload without waiting for PGYER processing |

The legacy `--app-key` upload option is not supported by fast upload. PGYER
associates the uploaded package with an app using its package identifier.

The file transfer itself has no overall time limit; it is aborted only when no
data moves for 5 minutes. If processing takes longer than `--timeout`, the
error shows the build key, and `pgyer uploads wait <key>` keeps waiting.

## Asynchronous Uploads

Use `--no-wait` when a pipeline should release its worker while PGYER processes
the package. The returned `uploadKey` can be checked once or waited on later.

```bash
UPLOAD_KEY=$(
  pgyer upload ./app.apk --no-wait --json |
  jq -r '.uploadKey'
)

# Query once; returns pending or published
pgyer uploads status "$UPLOAD_KEY" --json

# Poll until published or timed out
pgyer uploads wait "$UPLOAD_KEY" \
  --timeout 600 \
  --poll-interval 3 \
  --json
```

`uploads status` performs one request. `uploads wait` polls until PGYER
publishes the build or the configured timeout expires.

## AI Clients (MCP)

`pgyer mcp` starts an [MCP](https://modelcontextprotocol.io) server on stdio,
so AI clients can upload packages and look up apps and versions. It
authenticates like the CLI: `PGYER_API_KEY` first, then the credentials saved
by `pgyer auth login`. Get an API key from the
[PGYER API page](https://www.pgyer.com/account/api).

The snippets below run `npx -y @pgyer/cli mcp`, which needs no installation.
With the CLI installed globally and logged in, you can use `pgyer mcp` instead
and leave out `PGYER_API_KEY`. Existing configurations that run
`npx -y pgyer-mcp-server` start the same server and keep working.

**Claude Code**

```bash
claude mcp add pgyer --env PGYER_API_KEY=<your_api_key> -- npx -y @pgyer/cli mcp
```

**Claude Desktop** (`claude_desktop_config.json`) and **Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json` in a project)

```json
{
  "mcpServers": {
    "pgyer": {
      "command": "npx",
      "args": ["-y", "@pgyer/cli", "mcp"],
      "env": { "PGYER_API_KEY": "<your_api_key>" }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`; prompts for the API key on start)

```json
{
  "inputs": [
    { "type": "promptString", "id": "pgyer-api-key", "description": "PGYER API Key", "password": true }
  ],
  "servers": {
    "pgyer": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@pgyer/cli", "mcp"],
      "env": { "PGYER_API_KEY": "${input:pgyer-api-key}" }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`; raise the default 60-second tool timeout for large uploads)

```toml
[mcp_servers.pgyer]
command = "npx"
args = ["-y", "@pgyer/cli", "mcp"]
env = { PGYER_API_KEY = "<your_api_key>" }
tool_timeout_sec = 900
```

### MCP tools

| Tool | What it does | Read-only | Overwrites state |
| --- | --- | --- | --- |
| `upload_app` | Uploads an .apk/.ipa/.hap and returns the download page and QR code; takes every upload setting and sends progress notifications | No | No |
| `get_upload_status` | Checks a build by its buildKey (after a processing timeout) | Yes | No |
| `list_apps` | Lists apps, page by page | Yes | No |
| `get_app` | Gets an app's details by appKey or shortcut | Yes | No |
| `list_versions` | Lists an app's versions, page by page | Yes | No |
| `set_latest_version` | Sets or removes the latest-version mark | No | Yes |
| `update_app_settings` | Changes the shortcut, install type, install period, page language and more; other settings stay as they are | No | Yes |

The MCP server has no delete tools and never returns install passwords. Only
MCP messages go to stdout; diagnostics go to stderr.

## Command Reference

### Authentication

| Command | Description |
| --- | --- |
| `pgyer auth login` | Authenticate through the browser and save credentials locally |
| `pgyer auth logout` | Remove saved credentials while preserving unrelated configuration |
| `pgyer auth status` | Show the current authentication state |
| `pgyer auth token` | Show the active token in redacted form |
| `pgyer auth token --reveal` | Explicitly reveal the complete active token |

Browser login requires an interactive terminal. In CI and other
non-interactive environments, use `PGYER_API_KEY`.

### Apps

| Command | Description |
| --- | --- |
| `pgyer apps list` | List the first page of apps |
| `pgyer apps list --page <number>` | List a specific page |
| `pgyer apps list --all` | Fetch every available page |
| `pgyer apps info <appKey>` | Show the current build and app details |
| `pgyer apps info <appKey> --build <buildKey>` | Show a specific historical build |
| `pgyer apps resolve <shortcut>` | Resolve a shortcut or full PGYER URL |
| `pgyer apps update <appKey> [options]` | Merge selected settings into the current app configuration |
| `pgyer apps delete <appKey>` | Permanently delete an app and all of its builds |

Examples:

```bash
pgyer apps resolve PgY8
pgyer apps resolve https://www.pgyer.com/PgY8

pgyer apps info <appKey> --build <buildKey>
pgyer apps update <appKey> --language auto --auto-sync on
pgyer apps delete <appKey> --dry-run
```

### App settings

`apps update` reads the current app settings first and submits a merged update,
so omitted fields are preserved.

| Option | Accepted values | Description |
| --- | --- | --- |
| `--shortcut <shortcut>` | String | Change the download-page shortcut |
| `--install <type>` | `public`, `password`, `invite` | Change the installation policy |
| `--password <password>` | String | Set the installation password |
| `--password-env <name>` | Environment variable | Read the installation password without exposing it in shell history |
| `--valid-from <YYYY-MM-DD>` | Date | Start installation validity |
| `--valid-until <YYYY-MM-DD>` | Date | End installation validity |
| `--no-expiry` | — | Disable installation expiration |
| `--language <language>` | `zh`, `en`, `auto` | Set the download-page language |
| `--version-source <source>` | `pgyer`, `app` | Select PGYER or package metadata as the version source |
| `--auto-sync <state>` | `on`, `off` | Toggle automatic app-information synchronization |
| `--copyright <state>` | `on`, `off` | Show or hide PGYER copyright information |
| `--dry-run` | — | Validate and display the proposed update without modifying the app |

### Versions

| Command | Description |
| --- | --- |
| `pgyer versions list <appKey>` | List the first page of historical builds |
| `pgyer versions list <appKey> --all` | Fetch all historical-build pages |
| `pgyer versions set-latest <buildKey>` | Mark a build as the latest version |
| `pgyer versions unset-latest <buildKey>` | Remove the explicit latest-version mark |
| `pgyer versions check <appKey>` | Query PGYER update information |
| `pgyer versions delete <buildKey>` | Permanently delete one historical build |

Update-check context can be supplied explicitly:

```bash
pgyer versions check <appKey> \
  --current-version 1.2.0 \
  --build-version 42 \
  --channel beta
```

State-changing version commands support `--dry-run`. Version deletion is
irreversible and requires confirmation or `--force`.

## Output and Automation

The default output is concise and readable for both people and AI agents. Use
`--json` only when a script or integration requires deterministic parsing.

```bash
# Default readable output
pgyer apps list

# Explicit machine-readable output
pgyer apps list --all --json | jq '.apps | length'
```

Successful JSON output is command-specific and is not wrapped in a universal
envelope. JSON errors use a stable structure on stderr:

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "API Key is required",
    "retryable": false,
    "hint": "Run pgyer auth login or set PGYER_API_KEY"
  }
}
```

Automation guarantees:

- Successful results are written to stdout; errors are written to stderr.
- Failed commands exit with a non-zero status.
- `--json` never prompts for input.
- A process without an interactive stdin never prompts for confirmation.
- Destructive commands require explicit `--force` when confirmation is unavailable.
- App updates and destructive operations provide `--dry-run` where applicable.

`--human` / `-H` remains available as an explicit compatibility option. If
`--human` and `--json` are both present, `--human` takes precedence.

## Authentication and Security

Authentication sources are resolved in this order:

1. `PGYER_API_KEY` environment variable
2. Credentials saved by `pgyer auth login`

Saved credentials are stored at:

```text
~/.config/pgyer/config.json
```

The CLI sets this file to mode `600` where supported. Tokens are redacted by
default, installation passwords can be read from environment variables, and
sensitive values are not included in normal success or error output.

The API key is sent only in POST request bodies, never in a URL. The CLI uses
`https://www.pgyer.com`, then `https://www.xcxwo.com`, then
`https://www.pgyerapp.com`, moving on only after a network error or a non-JSON
answer (such as a hijacked DNS page). To always use another address, set
`"apiUrl"` in the configuration file; the CLI then uses only that address.

Every request carries a `pgyer-cli/<version> Node/<version>` User-Agent;
requests made by `pgyer mcp` start with `pgyer-mcp-server/<version>`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

The packaged executable is generated at `dist/index.js`; the MCP server entry
point (`@pgyer/cli/mcp`) is `dist/mcp.js`.

## Documentation

- [PGYER API documentation](https://www.pgyer.com/doc/view/api)
- [Technical specification](./docs/TECH_SPEC.md)

## License

MIT
