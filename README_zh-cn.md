# @pgyer/cli

PGYER 应用分发平台的命令行工具，支持应用上传、管理和账户认证。

## 安装

```bash
# 全局安装
npm install -g @pgyer/cli

# 或通过 npx 直接使用
npx @pgyer/cli
```

要求 Node.js >= 18.0.0。

## 快速开始

```bash
# 登录账户
pgyer auth login

# 上传应用
pgyer upload ./app-release.apk

# 查看应用列表
pgyer apps list
```

## 输出模式

工具支持两种输出模式，适配不同使用场景。

### 自适应模式（默认）

未指定 `--human` 或 `--json` 时，工具会根据运行环境自动选择输出模式：

- **终端 (TTY)** — 自动启用 Human 模式，带颜色、动画和表格
- **管道/脚本/CI** — 自动启用 JSON 模式，纯结构化数据输出

```bash
# 终端中直接运行 → Human 模式
pgyer apps list

# 管道中运行 → JSON 模式
pgyer apps list | jq '.apps[0].name'
```

### `--human` / `-H` 模式

强制启用人类友好输出，适合交互式使用：

- 彩色文本和状态图标（`✔` `✖` `ℹ`）
- 加载动画（spinner）
- 表格对齐显示

```bash
$ pgyer apps list --human
✔ Found 2 apps

name    │ bundleId            │ version │ appKey │ type │ size    │ createdAt
────────┼─────────────────────┼─────────┼────────┼──────┼─────────┼─────────────────────
MyApp   │ com.example.app     │ 1.0.0   │ abc123 │ iOS  │ 11.8 MB │ 2024-01-01 00:00:00

$ pgyer auth status --human
✔ Logged in as username <uKey>
```

### `--json` 模式

强制 JSON 输出，适合脚本解析和 LLM 调用：

- 无颜色、无动画、无格式化
- 结构化 JSON 数据输出到 stdout
- 错误信息以 `Error:` 前缀输出到 stderr

```bash
$ pgyer apps list --json
{"apps":[{"name":"MyApp","bundleId":"com.example.app","version":"1.0.0","appKey":"abc123","type":"iOS","size":"11.8 MB","createdAt":"2024-01-01 00:00:00"}]}

$ pgyer auth status --json
{"loggedIn":true,"user":"username"}
```

### 优先级

`--human` > `--json` > TTY 自适应

同时指定 `--human` 和 `--json` 时，`--human` 优先。

## 命令参考

### `pgyer auth login`

通过浏览器授权登录。自动启动本地回调服务器，打开浏览器完成授权后将凭证保存到配置文件。

```bash
pgyer auth login
```

### `pgyer auth logout`

清除本地存储的登录凭证，保留其他配置项。

```bash
pgyer auth logout
```

### `pgyer auth status`

检查当前登录状态。

```bash
$ pgyer auth status
{"loggedIn":true,"user":"username"}

$ pgyer auth status --human
✔ Logged in as username <uKey>
```

如果通过环境变量 `PGYER_API_KEY` 认证，会显示 "Logged in via API"。

### `pgyer auth token`

显示当前的 API Token。

```bash
$ pgyer auth token
{"token":"your-api-key-here"}

$ pgyer auth token --human
API Token: your-api-key-here
```

### `pgyer apps list`

列出当前账户下的所有应用。

```bash
pgyer apps list
```

### `pgyer apps info <appKey>`

查看指定应用的详细信息。

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

删除指定应用。Human 模式下会要求确认，使用 `--force` 跳过。

```bash
pgyer apps delete abc123
pgyer apps delete abc123 --force
```

### `pgyer upload <file>`

上传 IPA、APK 或 HAP 安装包。

```bash
pgyer upload ./app-release.apk
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--app-key <key>` | 指定目标应用（不指定则自动匹配） |
| `--build-update-description <desc>` | 版本更新说明 |
| `--password <pwd>` | 安装密码（设为密码安装） |
| `--invite-install` | 设为邀请安装（不能与 `--password` 同时使用） |
| `--pubstart <date>` | 安装有效期开始日期（YYYY-MM-DD） |
| `--pubend <date>` | 安装有效期结束日期（YYYY-MM-DD） |
| `--short <shortcut>` | 渠道短链接 |

**示例：**

```bash
# 上传并设置密码安装
pgyer upload ./app.apk --password 123456

# 上传并指定有效期
pgyer upload ./app.ipa --pubstart 2024-01-01 --pubend 2024-12-31

# 上传并设置更新说明
pgyer upload ./app.apk --build-update-description "修复了已知问题"
```

> `--pubstart` 和 `--pubend` 必须同时使用，且结束日期必须大于开始日期。

## 配置

### 优先级

CLI 参数 > 环境变量 > 配置文件

### 环境变量

| 变量 | 说明 |
|------|------|
| `PGYER_API_KEY` | API Key，可替代 `auth login` 进行认证 |
| `PGYER_OUTPUT_FORMAT` | 输出格式，`json` 或 `text` |

```bash
# 在 CI 环境中使用环境变量认证
export PGYER_API_KEY=your-api-key
pgyer upload ./app.apk
```

### 配置文件

路径：`~/.config/pgyer/config.json`

```json
{
  "apiKey": "xxx",
  "apiUrl": "https://api.pgyer.com",
  "outputFormat": "json"
}
```

配置文件权限自动设置为 `600`（仅所有者可读写）。

## License

MIT
