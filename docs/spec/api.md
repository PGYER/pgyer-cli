# API 规范

## 基础配置

**API 服务器**：未配置 `apiUrl` 时依次尝试：

1. `https://www.pgyer.com`
2. `https://www.xcxwo.com`
3. `https://www.pgyerapp.com`

只有网络错误（连接失败、超时、DNS 失败）或非 JSON 响应（劫持页、代理错误页、缺少 `code` 字段）才切换到下一个域名；返回 JSON 的 API 错误（`code != 0`）立即失败，不再尝试其他域名。某个域名成功后，同一进程内（例如长时间运行的 `pgyer mcp`）使用同一域名列表的后续请求优先使用它。配置文件中设置了 `apiUrl` 时只使用该地址，不做切换。

**认证方式**：`_api_key` 只放在 POST 表单正文中，任何请求都不得把 API Key 放进 URL（URL 会进入访问日志）。

**User-Agent**：每个请求（API 与 COS 上传）都带 User-Agent：CLI 为 `pgyer-cli/<version> Node/<process.version>`；`pgyer mcp` 为 `pgyer-mcp-server/<version> pgyer-cli/<version> Node/<process.version>`。

**超时**：单个 API 请求 30 秒；不跟随重定向（3xx 视为非 JSON 响应）。

## 请求封装

```typescript
// core/api.ts
interface RequestOptions {
  /** 兼容保留：所有请求都以 POST 表单发送 */
  method?: 'GET' | 'POST';
  path: string;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}

class ApiClient {
  constructor(config: Config, options?: { userAgent?: string; servers?: string[] });

  /** 依次尝试 API 服务器，返回 data */
  request<T>(options: RequestOptions): Promise<T>;
  /** 同上，同时返回成功的服务器（上传轮询沿用该服务器） */
  requestWithServer<T>(options: RequestOptions): Promise<{ server: string; data: T }>;
  /** 只请求指定服务器，不切换 */
  requestAt<T>(server: string, options: RequestOptions): Promise<T>;
}
```

- 请求体为 `application/x-www-form-urlencoded`：`_api_key` + `params` + `body`，忽略 `undefined`/`null`
- 响应 `code` 可能是字符串或数字，统一按数字比较
- 网络错误与非 JSON 响应抛出 `NetworkError`；`code != 0` 抛出 `ApiError`

## API 接口

### 获取 App 列表

```
POST /apiv2/app/listMy
Content-Type: application/x-www-form-urlencoded

Params:
- _api_key: string (必填)
- page: integer (选填)

Response:
{
  "code": 0,
  "message": "",
  "data": {
    "list": [
      {
        "buildKey": "xxx",
        "buildType": "1",
        "buildFileSize": "12345678",
        "buildName": "MyApp",
        "buildVersion": "1.0.0",
        "buildVersionNo": "1",
        "buildBuildVersion": "1",
        "buildIdentifier": "com.example.app",
        "buildIcon": "xxx",
        "buildCreated": "2024-01-01 00:00:00",
        "appKey": "xxx"
      }
    ]
  }
}
```

### 获取 App 详情

```
POST /apiv2/app/view
Content-Type: application/x-www-form-urlencoded

Params:
- _api_key: string (必填)
- appKey: string (必填)
- buildKey: string (选填，指定版本)

Response:
{
  "code": 0,
  "message": "",
  "data": {
    "buildKey": "xxx",
    "buildType": "1",
    "buildName": "MyApp",
    "buildVersion": "1.0.0",
    "buildVersionNo": "1",
    "buildBuildVersion": "1",
    "buildIdentifier": "com.example.app",
    "buildIcon": "xxx",
    "buildFileSize": "12345678",
    "buildCreated": "2024-01-01 00:00:00",
    "buildUpdated": "2024-01-01 00:00:00",
    "buildShortcutUrl": "abc123",
    "buildInstallType": "1",
    "buildPassword": "",
    "buildDescription": "",
    "buildUpdateDescription": "",
    "appKey": "xxx",
    "iconUrl": "https://...",
    "buildQRCodeURL": "https://...",
    "appExpiredDate": "2025-01-01 00:00:00"
  }
}
```

### 快速上传 App

```
POST /apiv2/app/getCOSToken
POST <response.data.endpoint>
POST /apiv2/app/buildInfo
```

第一步参数（可选参数只在用户设置时发送）：

- _api_key: string
- buildType: ios | android | harmony
- oversea: 1 | 2 (optional, 1=海外，2=国内；不设置时不发送，由服务器按 IP 判断)
- buildDescription: string (optional, 应用介绍)
- buildUpdateDescription: string (optional)
- buildInstallType: number (optional, 1=公开 2=密码 3=邀请；不设置时不发送，蒲公英保留应用当前设置；只设置密码时发送 2)
- buildPassword: string (optional, buildInstallType=2 时需要)
- buildInstallDate: string (optional, 开始和结束日期同时设置时发送 "1")
- buildInstallStartDate: string (optional, 格式 YYYY-MM-DD)
- buildInstallEndDate: string (optional, 格式 YYYY-MM-DD)
- buildChannelShortcut: string (optional, 渠道短链接)

第二步使用动态 endpoint 与 `params` 中的全部字段、`x-cos-meta-file-name` 和文件流上传，任何 2xx 响应都视为成功。

第三步向获取凭证成功的同一服务器 POST `_api_key` 与 `buildKey`（第一步返回的 `key`）。`code=1246`/`1247` 表示正在处理并继续轮询，`code=0` 返回最终 App 信息。

### 删除 App

```
POST /apiv2/app/deleteApp
Content-Type: application/x-www-form-urlencoded

Params:
- _api_key: string (必填)
- appKey: string (必填)

Response:
{
  "code": 0,
  "message": ""
}
```

## Token 验证（待实现）

预留接口，后续可用于在执行需要认证的操作前验证 Token 是否有效：

```
POST /apiv2/user/view
Content-Type: application/x-www-form-urlencoded

Params:
- _api_key: string (必填)
```
