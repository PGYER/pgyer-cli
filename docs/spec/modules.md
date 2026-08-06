# 模块设计

## auth 模块

### `pgyer auth login`

网页授权登录，通过本地回调服务器获取 Token。

**流程**:

1. 启动本地 HTTP 服务器，监听端口 3456（可配置）
2. 调用 `open` 打开浏览器访问 `https://www.pgyer.com/account/api?cli_auth_port=3456`
3. 用户在浏览器中授权
4. 浏览器重定向到 `http://localhost:3456/?auth=<base64url>` ，`auth` 参数为 base64url 编码的 JSON：`{ "ukey": "xxx", "name": "xxx", "apikey": "xxx" }`
5. 本地服务器解析参数，保存到配置文件
6. 返回成功 HTML，关闭服务器

**输出**:

```bash
# 默认
{
  "success": true,
  "user": "username",
  "ukey": "<uKey>"
}

# --human
✔ Login successful! Logged in as username <uKey>
```

### `pgyer auth logout`

清除本地存储的 Token。

**输出**:

```bash
# 默认
{
  "success":true
}

# --human
✔ Logged out successfully
```

### `pgyer auth status`

检查当前登录状态。

**输出**:

```bash
# 已登录
{
  "loggedIn":true,
  "user":"username"
}

# 未登录
{
  "loggedIn":false
}

# --human
✔ Logged in as username <uKey>
✔ Logged in via API
```

### `pgyer auth token`

显示当前存储的 API Token。

**输出**:

```bash
# 默认
{
  "token":"xxx"
}

# --human
API Token: xxx
```

---

## apps 模块

### `pgyer apps list`

列出当前用户的所有应用。

**输出**:

```bash
# 默认
{"apps":[{"name":"MyApp","bundleId":"com.example.app","version":"1.0.0","appKey":"abc123","type":"iOS","size":"11.8 MB","createdAt":"2024-01-01 00:00:00"}]}

# --human
┌─────────┬────────────────────┬─────────┬──────────┬────────┬─────────┬─────────────────────┐
│ Name    │ Bundle ID          │ Version │ App Key  │ Type   │ Size    │ Created              │
├─────────┼────────────────────┼─────────┼──────────┼────────┼─────────┼─────────────────────┤
│ MyApp   │ com.example.app    │ 1.0.0   │ abc123   │ iOS    │ 11.8 MB │ 2024-01-01 00:00:00  │
└─────────┴────────────────────┴─────────┴──────────┴────────┴─────────┴─────────────────────┘
```

### `pgyer apps info <appKey>`

查看应用详情。

**输出**:

```bash
# 默认
{"name":"MyApp","bundleId":"com.example.app","appKey":"abc123","version":"1.0.0","buildVersion":"1","type":"Android","size":"10.0 MB","shortcut":"abc","installType":"Public","createdAt":"2024-01-01 00:00:00","updatedAt":"2024-01-01 00:00:00","expiredAt":"2025-01-01 00:00:00"}

# --human
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

删除应用（需确认）。

**选项**:

- `--force` / `-f` - 跳过确认直接删除

**输出**:

```bash
# 默认
{"success":true}

# --human
✔ App deleted successfully
```

---

## upload 模块

### `pgyer upload <file> [options]`

通过 API 2.0 快速上传流程上传应用安装包。命令默认等待蒲公英完成解析并返回最终版本信息。

**参数**:

- `<file>` - IPA、APK 或 HAP 文件路径

**选项**:

- `--app-key <key>` - 兼容保留；新版接口不支持，使用时返回明确错误
- `--description <text>` - 应用介绍
- `--build-update-description <desc>` - 版本更新说明
- `--password <pwd>` - 安装密码（设置安装类型为密码安装）
- `--invite-install` - 设置安装类型为邀请安装（不能与 --password 同时使用）
- `--pubstart <date>` - 安装有效期开始日期（格式：YYYY-MM-DD）
- `--pubend <date>` - 安装有效期结束日期（格式：YYYY-MM-DD）
- `--short <shortcut>` - 渠道短链接
- `--upload-region <auto|overseas|domestic>` - 上传区域
- `--timeout <seconds>` - 上传及解析总超时，默认 300 秒
- `--poll-interval <seconds>` - 解析轮询间隔，默认 4 秒
- `--no-wait` - 文件上传成功后立即返回上传 key

**安装类型判断逻辑**:

1. 若 `--invite-install` 和 `--password` 同时使用，报错
2. 若 `--invite-install` 存在，则为邀请安装（type=3）
3. 若 `--password` 有值，则为密码安装（type=2）
4. 其他情况为公开安装（type=1）

**有效期校验规则**:

- `--pubstart` 和 `--pubend` 必须同时存在或同时不存在
- 若只存在其中一个，则报错
- `--pubend` 日期必须大于 `--pubstart`
- 满足条件时设置 `buildInstallDate=1`

**输出**:

```bash
# 默认
{"success":true,"buildKey":"xxx","buildVersion":"1.0.0","buildBuildVersion":"1"}

# --human
✔ Upload successful!
  Version: 1.0.0 (Build 1)
  URL: https://www.pgyer.com/xxx
```

快速上传由 `getCOSToken`、向动态 COS endpoint 流式上传、`buildInfo` 轮询三步组成。存储上传必须返回 HTTP 204；`buildInfo` 返回 1247 表示继续解析。

---

## versions 模块

版本模块支持历史版本分页、设置/取消最新版、检测更新和删除版本。删除版本必须交互确认或显式使用 `--force`。

```bash
pgyer versions list <appKey> [--page <number>] [--all]
pgyer versions set-latest <buildKey>
pgyer versions unset-latest <buildKey>
pgyer versions check <appKey> [--current-version <version>] [--build-version <number>] [--channel <key>]
pgyer versions delete <buildKey> --force
```

## apps 扩展

```bash
pgyer apps list [--page <number>] [--all]
pgyer apps info <appKey> [--build <buildKey>]
pgyer apps resolve <shortcut>
pgyer apps update <appKey> [settings]
```

`apps update` 必须先读取当前配置后合并用户明确指定的字段，以避免 API 的全量更新语义覆盖未修改设置。
