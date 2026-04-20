# API 规范

## 基础配置

**Base URL**: `https://api.pgyer.com`

**认证方式**: 请求参数携带 `_api_key`

## 请求封装

```typescript
// core/api.ts
interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  params?: Record<string, unknown>;
  body?: FormData | Record<string, unknown>;
}

class ApiClient {
  private baseUrl: string;
  private apiKey: string | null;

  async request<T>(options: RequestOptions): Promise<T> {
    const url = new URL(this.baseUrl + options.path);

    // 注入 _api_key
    if (this.apiKey) {
      options.params = { ...options.params, _api_key: this.apiKey };
    }

    // 构建请求
    const response = await fetch(url, {
      method: options.method,
      body: options.body instanceof FormData ? options.body : JSON.stringify(options.body),
    });

    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const data = await response.json();

    if (data.code !== 0) {
      throw new ApiError(data.code, data.message);
    }

    return data.data;
  }
}
```

## 错误处理

```typescript
class ApiError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
```

**输出格式**:

```bash
# 默认模式
Error: [10001] Invalid API Key

# --human 模式
✖ Error: Invalid API Key (code: 10001)
```

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
  "data": [
    {
      "buildKey": "xxx",
      "buildType": 1,
      "buildFileSize": 12345678,
      "buildName": "MyApp",
      "buildVersion": "1.0.0",
      "buildVersionNo": "1",
      "buildBuildVersion": 1,
      "buildIdentifier": "com.example.app",
      "buildIcon": "xxx",
      "buildCreated": "2024-01-01 00:00:00",
      "appKey": "xxx"
    }
  ]
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

### 上传 App

```
POST /apiv2/app/upload

Body (multipart/form-data):
- _api_key: string
- file: File
- buildUpdateDescription: string (optional)
- buildInstallType: number (optional)
- buildPassword: string (optional)

Response:
{
  "code": 0,
  "data": {
    "buildKey": "xxx",
    "buildVersion": "1.0.0",
    "buildBuildVersion": "1"
  }
}
```

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

## Token 验证

在执行需要认证的操作前，先验证 Token 是否有效：

```typescript
async function validateToken(): Promise<boolean> {
  try {
    await apiClient.request({ path: '/apiv2/user/view' });
    return true;
  } catch {
    return false;
  }
}
```
