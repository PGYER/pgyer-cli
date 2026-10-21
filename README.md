# @pgyer/cli

简体中文 | [English](./README_EN.md)

面向[蒲公英](https://www.pgyer.com/)应用分发平台的现代化命令行工具。支持通过 API 2.0
快速上传 IPA、APK 和 HAP 安装包，管理应用与历史构建，并可用于 CI 和 AI Agent
自动化流程。内置 MCP 服务器（`pgyer mcp`），Claude、Cursor、VS Code、Codex 等
AI 客户端可以直接调用。

## 核心能力

- 基于 API 2.0 的流式快速上传
- 支持 IPA、APK 和 HAP 安装包
- 支持国内、海外和自动上传区域选择
- 支持同步等待与异步状态跟踪
- 支持应用查询、设置管理和安全删除
- 支持历史版本、更新检查、最新版控制和版本删除
- 默认输出适合真人与 AI Agent 阅读，自动化场景可显式使用 JSON
- 支持非交互保护、`--dry-run`、凭证脱敏和稳定错误结构
- 内置 MCP 服务器，AI 客户端可直接上传和管理应用
- 主域名无法访问时自动切换备用域名

## 环境要求

- Node.js 20.19 或更高版本
- 蒲公英账号或 API Key

## 安装

全局安装：

```bash
npm install --global @pgyer/cli
```

也可以不安装直接运行：

```bash
npx @pgyer/cli --help
```

## 快速开始

```bash
# 通过浏览器登录
pgyer auth login

# 确认当前账号
pgyer auth status

# 上传并等待蒲公英完成解析
pgyer upload ./app-release.apk

# 查看应用和历史构建
pgyer apps list
pgyer versions list <appKey>
```

CI 环境可以直接注入 API Key，无需启动浏览器登录：

```bash
export PGYER_API_KEY="your-api-key"
pgyer upload ./app-release.apk --json
```

## 快速上传

`pgyer upload` 使用蒲公英 API 2.0 快速上传流程：CLI 首先申请上传凭证，随后将安装包
以流式方式直接上传至对象存储；除非使用 `--no-wait`，否则会继续等待蒲公英完成解析并发布。

```bash
# 自动选择上传区域
pgyer upload ./app.apk

# 使用国内上传节点，上传完成后最长等待解析 15 分钟
pgyer upload ./app.hap --upload-region domestic --timeout 900

# 添加版本更新说明
pgyer upload ./app.ipa \
  --build-update-description "优化启动速度并修复已知问题"
```

### 安装控制

不建议直接把安装密码写入命令行历史。单独使用 `--password-env` 时会读取
`PGYER_INSTALL_PASSWORD`，也可以指定自定义环境变量名称。

```bash
export PGYER_INSTALL_PASSWORD="replace-with-a-secret"
pgyer upload ./app.apk --password-env

export RELEASE_INSTALL_PASSWORD="replace-with-a-secret"
pgyer upload ./app.apk --password-env RELEASE_INSTALL_PASSWORD

pgyer upload ./app.apk --invite-install
pgyer upload ./app.apk --install-type public
pgyer upload ./app.ipa --pubstart 2026-08-01 --pubend 2026-12-31
```

`--pubstart` 和 `--pubend` 必须同时使用，结束日期必须晚于开始日期。

上传只发送你指定的设置。没有指定 `--install-type`、`--password` 或 `--invite-install`
时，应用保持当前的安装方式（0.1.x 会把它重置为公开安装）；需要公开安装时请使用
`--install-type public`。

### 上传参数

| 参数 | 说明 |
| --- | --- |
| `--description <text>` | 设置应用介绍 |
| `--build-update-description <text>` | 设置本次构建的版本更新说明 |
| `--install-type <type>` | 安装方式：`public`、`password` 或 `invite`；默认保持应用当前设置 |
| `--password <password>` | 使用密码安装 |
| `--password-env [name]` | 从环境变量读取密码，默认读取 `PGYER_INSTALL_PASSWORD` |
| `--invite-install` | 限制为受邀用户安装 |
| `--pubstart <YYYY-MM-DD>` | 设置安装有效期开始日期 |
| `--pubend <YYYY-MM-DD>` | 设置安装有效期结束日期 |
| `--short <shortcut>` | 设置渠道短链接 |
| `--upload-region <region>` | 选择 `auto`、`domestic` 或 `overseas`，默认 `auto` |
| `--timeout <seconds>` | 文件上传完成后等待蒲公英解析的最长时间，默认 `600` 秒 |
| `--poll-interval <seconds>` | 设置构建解析轮询间隔，默认 `3` 秒 |
| `--no-wait` | 文件上传成功后立即返回，不等待蒲公英解析 |

快速上传不支持旧版 `--app-key` 参数。蒲公英会根据安装包的包标识符，将新构建关联到
对应应用。

文件上传本身没有总时长限制（5 分钟内没有任何数据收发时才会中止）。解析超时后，
错误信息会给出构建 key，可以用 `pgyer uploads wait <key>` 继续等待。

## 异步上传

如果流水线不需要占用执行器等待蒲公英解析，可以使用 `--no-wait`。CLI 返回的
`uploadKey` 可以用于单次查询，也可以在后续步骤中持续等待。

```bash
UPLOAD_KEY=$(
  pgyer upload ./app.apk --no-wait --json |
  jq -r '.uploadKey'
)

# 查询一次，返回 pending 或 published
pgyer uploads status "$UPLOAD_KEY" --json

# 持续轮询，直到发布完成或超时
pgyer uploads wait "$UPLOAD_KEY" \
  --timeout 600 \
  --poll-interval 3 \
  --json
```

`uploads status` 只请求一次；`uploads wait` 会持续轮询，直到构建发布或达到超时时间。

## AI 客户端（MCP）

`pgyer mcp` 在 stdio 上启动 [MCP](https://modelcontextprotocol.io) 服务器，让 AI 客户端
直接上传安装包、查询应用和版本。认证方式与 CLI 相同：优先读取 `PGYER_API_KEY`，
否则使用 `pgyer auth login` 保存的凭证。API Key 可在
[蒲公英 API 页面](https://www.pgyer.com/account/api) 获取。

下面的配置使用 `npx -y @pgyer/cli mcp`，无需预先安装。已全局安装 CLI 并登录时，
也可以把命令换成 `pgyer mcp` 并省略 `PGYER_API_KEY`。旧配置中的
`npx -y pgyer-mcp-server` 会启动同一个服务器，可以继续使用。

**Claude Code**

```bash
claude mcp add pgyer --env PGYER_API_KEY=<your_api_key> -- npx -y @pgyer/cli mcp
```

**Claude Desktop**（`claude_desktop_config.json`）与 **Cursor**（`~/.cursor/mcp.json` 或项目内 `.cursor/mcp.json`）

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

**VS Code**（`.vscode/mcp.json`，启动时提示输入 API Key）

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

**Codex**（`~/.codex/config.toml`；上传大文件时需要调大默认 60 秒的工具超时）

```toml
[mcp_servers.pgyer]
command = "npx"
args = ["-y", "@pgyer/cli", "mcp"]
env = { PGYER_API_KEY = "<your_api_key>" }
tool_timeout_sec = 900
```

### MCP 工具

| 工具 | 作用 | 只读 | 覆盖已有状态 |
| --- | --- | --- | --- |
| `upload_app` | 上传 .apk/.ipa/.hap，返回下载页地址和二维码；支持全部上传设置，上传和解析期间发送进度通知 | 否 | 否 |
| `get_upload_status` | 按 buildKey 查询解析结果（解析超时后使用） | 是 | 否 |
| `list_apps` | 分页列出应用 | 是 | 否 |
| `get_app` | 按 appKey 或短链接查询应用详情 | 是 | 否 |
| `list_versions` | 分页列出应用的历史版本 | 是 | 否 |
| `set_latest_version` | 设置或取消最新版 | 否 | 是 |
| `update_app_settings` | 修改短链接、安装方式、有效期、页面语言等设置，未指定的设置保持不变 | 否 | 是 |

MCP 服务器不提供删除工具，也不会返回安装密码。stdout 只输出 MCP 协议消息，
诊断信息写入 stderr。

## 命令参考

### 身份认证

| 命令 | 说明 |
| --- | --- |
| `pgyer auth login` | 通过浏览器完成认证并在本地保存凭证 |
| `pgyer auth logout` | 删除已保存的凭证，保留无关配置 |
| `pgyer auth status` | 查看当前认证状态 |
| `pgyer auth token` | 脱敏显示当前 Token |
| `pgyer auth token --reveal` | 显式显示完整 Token |

浏览器登录要求交互式终端。CI 和其他非交互环境应使用 `PGYER_API_KEY`。

### 应用管理

| 命令 | 说明 |
| --- | --- |
| `pgyer apps list` | 查看第一页应用 |
| `pgyer apps list --page <number>` | 查看指定分页 |
| `pgyer apps list --all` | 获取全部应用分页 |
| `pgyer apps info <appKey>` | 查看当前构建和应用详情 |
| `pgyer apps info <appKey> --build <buildKey>` | 查看指定历史构建 |
| `pgyer apps resolve <shortcut>` | 解析短链接或完整蒲公英 URL |
| `pgyer apps update <appKey> [options]` | 将指定设置合并到当前应用配置 |
| `pgyer apps delete <appKey>` | 永久删除应用及其全部构建 |

示例：

```bash
pgyer apps resolve PgY8
pgyer apps resolve https://www.pgyer.com/PgY8

pgyer apps info <appKey> --build <buildKey>
pgyer apps update <appKey> --language auto --auto-sync on
pgyer apps delete <appKey> --dry-run
```

### 应用设置

`apps update` 会先读取当前应用设置，再提交合并后的配置，因此没有指定的字段会被保留。

| 参数 | 可选值 | 说明 |
| --- | --- | --- |
| `--shortcut <shortcut>` | 字符串 | 修改下载页短链接 |
| `--install <type>` | `public`、`password`、`invite` | 修改安装方式 |
| `--password <password>` | 字符串 | 设置安装密码 |
| `--password-env <name>` | 环境变量名称 | 从环境变量读取安装密码，避免出现在命令行历史中 |
| `--valid-from <YYYY-MM-DD>` | 日期 | 设置安装有效期开始日期 |
| `--valid-until <YYYY-MM-DD>` | 日期 | 设置安装有效期结束日期 |
| `--no-expiry` | — | 关闭安装有效期限制 |
| `--language <language>` | `zh`、`en`、`auto` | 设置下载页语言 |
| `--version-source <source>` | `pgyer`、`app` | 使用蒲公英或安装包元数据作为版本来源 |
| `--auto-sync <state>` | `on`、`off` | 开启或关闭应用信息自动同步 |
| `--copyright <state>` | `on`、`off` | 显示或隐藏蒲公英版权信息 |
| `--dry-run` | — | 校验并显示变更计划，不修改线上应用 |

### 版本管理

| 命令 | 说明 |
| --- | --- |
| `pgyer versions list <appKey>` | 查看第一页历史构建 |
| `pgyer versions list <appKey> --all` | 获取全部历史构建分页 |
| `pgyer versions set-latest <buildKey>` | 将指定构建设为最新版 |
| `pgyer versions unset-latest <buildKey>` | 取消显式最新版标记 |
| `pgyer versions check <appKey>` | 查询蒲公英更新信息 |
| `pgyer versions delete <buildKey>` | 永久删除一个历史构建 |

可以显式提供客户端当前版本信息：

```bash
pgyer versions check <appKey> \
  --current-version 1.2.0 \
  --build-version 42 \
  --channel beta
```

会修改状态的版本命令支持 `--dry-run`。版本删除不可恢复，需要交互确认或显式使用
`--force`。

## 输出与自动化

CLI 默认使用简洁、清晰的人类可读输出，真人和 AI Agent 都可以直接理解。只有脚本或
系统集成需要稳定解析时，才建议显式使用 `--json`。

```bash
# 默认可读输出
pgyer apps list

# 显式机器可读输出
pgyer apps list --all --json | jq '.apps | length'
```

成功的 JSON 结果由各命令根据自身语义返回，不强制使用统一 envelope。JSON 模式下的
错误会以稳定结构写入 stderr：

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

自动化行为保证：

- 成功结果写入 stdout，错误写入 stderr。
- 命令失败时返回非零退出码。
- `--json` 模式绝不会请求交互输入。
- 没有交互式 stdin 时绝不会弹出确认提示。
- 无法交互确认时，破坏性命令必须显式使用 `--force`。
- 应用设置和破坏性操作在适用场景提供 `--dry-run`。

`--human` / `-H` 作为显式兼容选项保留。同时使用 `--human` 和 `--json` 时，
`--human` 优先。

## 认证与安全

认证信息按以下顺序读取：

1. `PGYER_API_KEY` 环境变量
2. `pgyer auth login` 保存的本地凭证

本地凭证存储位置：

```text
~/.config/pgyer/config.json
```

在操作系统支持时，CLI 会将该文件权限设置为 `600`。Token 默认脱敏显示，安装密码可从
环境变量读取，正常成功或错误输出不会包含敏感值。

API Key 只放在 POST 请求正文中，不会出现在任何 URL 里。CLI 依次使用
`https://www.pgyer.com`、`https://www.xcxwo.com`、`https://www.pgyerapp.com`：只有网络
错误或非 JSON 响应（例如 DNS 劫持页面）才会切换到下一个域名。需要固定使用其他地址时，
可以在配置文件中设置 `"apiUrl"`，此时不再切换。

每个请求都带有 `pgyer-cli/<版本> Node/<版本>` 的 User-Agent；`pgyer mcp` 发出的请求以
`pgyer-mcp-server/<版本>` 开头。

## 本地开发

```bash
npm install
npm run typecheck
npm test
npm run build
```

打包后的可执行文件位于 `dist/index.js`，MCP 服务器入口（`@pgyer/cli/mcp`）位于 `dist/mcp.js`。

## 相关文档

- [蒲公英 API 文档](https://www.pgyer.com/doc/view/api)
- [技术设计规范](./docs/TECH_SPEC.md)

## License

MIT
