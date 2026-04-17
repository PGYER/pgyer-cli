# 模块设计

## auth 模块

### `pgyer auth login`

网页授权登录，通过本地回调服务器获取 Token。

**流程**:

1. 启动本地 HTTP 服务器，监听端口 3456（可配置）
2. 调用 `open` 打开浏览器访问 `https://www.pgyer.com/account/api?cli_request=3456`
3. 用户在浏览器中授权
4. 浏览器重定向到 `http://localhost:3456/callback?token=xxx&ukey=xxx`
5. 本地服务器解析参数，保存到配置文件
6. 返回成功 HTML，关闭服务器

**输出**:

```bash
# 默认
{"success":true,"user":"test@example.com"}

# --human
✔ Login successful! Logged in as test@example.com
```

### `pgyer auth logout`

清除本地存储的 Token。

**输出**:

```bash
# 默认
{"success":true}

# --human
✔ Logged out successfully
```

### `pgyer auth status`

检查当前登录状态。

**输出**:

```bash
# 已登录
{"loggedIn":true,"user":"test@example.com"}

# 未登录
{"loggedIn":false}
```

### `pgyer auth token`

显示当前存储的 API Token。

**输出**:

```bash
# 默认
{"token":"xxx","ukey":"yyy"}

# --human
API Token: xxx
User Key: yyy
```

---

## apps 模块

### `pgyer apps list`

列出当前用户的所有应用。

**输出**:

```bash
# 默认
{"apps":[{"name":"MyApp","bundleId":"com.example.app","appKey":"abc123"}]}

# --human
┌─────────┬────────────────────┬──────────┐
│ Name    │ Bundle ID          │ App Key  │
├─────────┼────────────────────┼──────────┤
│ MyApp   │ com.example.app    │ abc123   │
└─────────┴────────────────────┴──────────┘
```

### `pgyer apps info <appKey>`

查看应用详情。

**输出**:

```bash
# 默认
{"name":"MyApp","bundleId":"com.example.app","appKey":"abc123","version":"1.0.0","buildCount":10}

# --human
App: MyApp (com.example.app)
  App Key:   abc123
  Version:   1.0.0
  Builds:    10
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

上传应用安装包。

**参数**:
- `<file>` - IPA 或 APK 文件路径

**选项**:
- `--app-key <key>` - 指定应用（可选，不指定则自动匹配）
- `--build-update-description <desc>` - 版本更新说明
- `--build-install-type <type>` - 安装类型: 1=公开, 2=密码, 3=邀请
- `--build-password <pwd>` - 安装密码 (type=2 时必填)

**输出**:

```bash
# 默认
{"success":true,"buildKey":"xxx","buildVersion":"1.0.0","buildBuildVersion":"1"}

# --human
✔ Upload successful!
  Version: 1.0.0 (Build 1)
  URL: https://www.pgyer.com/xxx
```
