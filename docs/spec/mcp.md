# MCP 服务器（`pgyer mcp`）

`pgyer mcp` 在 stdio 上启动一个 [Model Context Protocol](https://modelcontextprotocol.io) 服务器，让 Claude、Cursor、VS Code、Codex 等 AI 客户端直接调用蒲公英的上传与应用管理能力。它复用 CLI 的核心模块（配置与认证、API 客户端、快速上传），不再维护第二份 API 代码。npm 包 `pgyer-mcp-server` 2.x 只是启动这个服务器的薄封装。

## 技术选择

- SDK：`@modelcontextprotocol/server`（MCP TypeScript SDK v2，当前稳定版本线）。v1 的 `@modelcontextprotocol/sdk` 已进入维护期，不支持 2026-07-28 协议；v2 同时兼容 2024-11-05 至 2025-11-25 的旧协议，现有客户端可以直接连接。
- 工具通过 `McpServer.registerTool` 注册，输入输出使用 zod schema，带 `annotations`，并在合适时返回 `structuredContent` 与 `outputSchema`。
- 测试使用 `@modelcontextprotocol/client`（仅开发依赖）。
- 服务器代码位于 `src/mcp/`，CLI 只在执行 `pgyer mcp` 时按需加载，不影响其他命令的启动速度。
- 包导出 `@pgyer/cli/mcp`：`runStdioServer(options?)` 与 `createPgyerMcpServer(options?)`，供 `pgyer-mcp-server` 封装包调用。

## 认证

每次调用工具时重新读取配置（优先级同 CLI）：

1. 环境变量 `PGYER_API_KEY`
2. `pgyer auth login` 保存在 `~/.config/pgyer/config.json` 的 API Key

缺少 API Key 时服务器照常启动（客户端可以列出工具），工具调用返回 `isError`，提示设置 `PGYER_API_KEY` 或运行 `pgyer auth login`。

## stdout 约束

stdout 只能输出 MCP 协议消息：

- 服务器启动前把 `console.log/info/debug/warn` 重定向到 stderr
- 不使用 spinner、表格或 Human 输出
- 诊断信息只写 stderr；不记录 API Key、安装密码、COS 签名或临时凭证

## User-Agent

`pgyer mcp` 发出的所有请求（API 与 COS 上传）使用：

```text
pgyer-mcp-server/<cli version> pgyer-cli/<cli version> Node/<process.version>
```

蒲公英服务端按第一个产品标识区分上传来源。CLI 命令仍使用 `pgyer-cli/<version> Node/<process.version>`。

## 工具

工具名使用 snake_case。不提供删除类工具。

| 工具 | 作用 | readOnly | destructive | idempotent |
| --- | --- | --- | --- | --- |
| `upload_app` | 上传 .apk/.ipa/.hap 并等待发布 | false | false | false |
| `get_upload_status` | 按 buildKey 查询（或在限定时间内等待）上传处理结果 | true | false | true |
| `list_apps` | 分页列出账号下的应用 | true | false | true |
| `get_app` | 按 appKey 或短链接查询应用详情，可指定历史版本 | true | false | true |
| `list_versions` | 分页列出应用的历史版本 | true | false | true |
| `set_latest_version` | 设置或取消某个版本为最新版 | false | true | true |
| `update_app_settings` | 合并修改应用设置（同 `pgyer apps update`） | false | true | true |

所有工具 `openWorldHint=true`（访问外部服务）。`set_latest_version` 与 `update_app_settings` 会覆盖现有状态而非追加，因此标记为 destructive；上传只新增版本，标记为非 destructive。

### `upload_app`

输入：`filePath`（必填）、`installType`（`public`/`password`/`invite`）、`password`、`updateDescription`、`description`、`installStartDate` + `installEndDate`（YYYY-MM-DD，必须同时提供）、`channelShortcut`、`oversea`（true=海外加速，false=国内，不传由服务器按 IP 判断）、`processingTimeoutSeconds`（默认 600）。

行为与 CLI 快速上传一致（见 [API 2.0 能力扩展](./api2-expansion.md)）：只发送用户设置的字段，单独设置密码视为密码安装。

输出（`structuredContent`）：`status`（`published` 或 `processing`）、`buildKey`、`appName`、`platform`、`version`、`versionCode`、`buildNumber`、`identifier`、`shortcut`、`downloadPageUrl`（`https://www.pgyer.com/<buildShortcutUrl>`）、`qrCodeUrl`、`fileName`、`fileSize`、`createdAt`、`updateDescription`。

处理超时不视为失败：返回 `status=processing` 与 `buildKey`，提示稍后调用 `get_upload_status`。

进度：如果客户端在请求 `_meta.progressToken` 中提供了 token，服务器发送 `notifications/progress`（total=100）：获取凭证 1%，文件上传 1–89%（按字节，最多每 5% 一次），等待处理 90–99%（按已等待时间占处理超时的比例），发布完成 100%。客户端取消请求时中止上传或轮询。

### `get_upload_status`

输入：`buildKey`、`waitSeconds`（0–600，默认 0 表示只查询一次）。输出同 `upload_app`。

### `list_apps`

输入：`page`（默认 1，每页 20 个）。输出：`page`、`pageCount`、`totalApps`、`apps[]`（`appKey`、`name`、`platform`、`version`、`buildNumber`、`identifier`、`shortcut`、`downloadPageUrl`、`latestBuildKey`、`lastUploadAt`）。不返回安装密码。

### `get_app`

输入：`appKey` 或 `shortcut`（二选一；短链接也可以是完整的 `https://www.pgyer.com/xxx` 地址），可选 `buildKey`（仅与 `appKey` 一起使用）。

按短链接查询时，接口不返回 appKey；服务器按短链接在应用列表中查找 appKey（最多 50 页），找到后再读取完整详情。输出包含版本信息、下载页、二维码、安装方式（不含密码）、安装有效期、页面语言、版本号来源、自动同步与版权显示设置。

### `list_versions`

输入：`appKey` 或 `shortcut`（二选一）、`page`。输出：`appKey`、`page`、`pageCount`、`versions[]`（`buildKey`、`version`、`versionCode`、`buildNumber`、`isLatest`、`createdAt`、`updateDescription`、`fileName`、`fileSize`）。

### `set_latest_version`

输入：`buildKey`、`latest`（默认 true；false 调用 `cancelNewestVersion` 取消最新版标记）。

### `update_app_settings`

输入：`appKey`，以及 `shortcut`、`installType`、`password`、`installStartDate` + `installEndDate`、`removeInstallPeriod`、`language`（`zh`/`en`/`auto`）、`versionSource`（`pgyer`/`app`）、`autoSync`、`showPgyerCopyright`、`dryRun`。与 `pgyer apps update` 共用核心合并逻辑：先读取当前设置，再合并明确指定的字段。

## 错误

- API 错误格式：`PGYER API error <code>: <message>`，对 1001/1002/1003/1019/1020/1022 追加与 Jenkins 插件相同的英文提示
- 参数校验失败、文件不存在、网络错误均返回 `isError` 结果，不抛出协议错误
