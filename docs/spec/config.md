# 配置管理设计

## 配置来源与优先级

配置按以下优先级加载（高优先级覆盖低优先级）：

1. **CLI 参数** — 命令行直接指定，最高优先级
2. **环境变量** — 系统环境变量
3. **配置文件** — `~/.config/pgyer/config.json`

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PGYER_API_KEY` | API Key 用于认证 | - |
| `PGYER_OUTPUT_FORMAT` | 输出格式 `json` / `text` | `json` |

## 配置文件

**路径**: `~/.config/pgyer/config.json`

**结构**:

```json
{
  "apiKey": "xxx",
  "outputFormat": "json"
}
```

`apiUrl` 可选。不设置时按 [API 规范](./api.md) 依次尝试 `https://www.pgyer.com`、`https://www.xcxwo.com`、`https://www.pgyerapp.com`；设置后只使用该地址（例如私有部署或测试服务器），不做域名切换。

**行为**:

- 配置目录不存在时自动创建
- 敏感信息（如 apiKey）设置文件权限为 600

## 实现要点

```typescript
// core/config.ts
interface Config {
  apiKey?: string;
  apiUrl?: string;
  outputFormat?: 'json' | 'text';
  ukey?: string;
  name?: string;
}

// 配置加载顺序
function loadConfig(): Config {
  const fileConfig = loadFromFile(getConfigPath());
  const envConfig = loadFromEnv();
  const cliConfig = loadFromCli();

  return { ...fileConfig, ...envConfig, ...cliConfig };
}
```
