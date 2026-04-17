# 输出模式设计

## 设计原则

CLI 工具需要同时支持两种使用场景：

1. **LLM/脚本调用** — 默认模式，机器可解析
2. **人类交互** — `--human` 模式，友好可读

## 默认模式 (LLM 友好)

**特点**:

- 无颜色、无动画、无格式化
- 结构化数据输出 JSON 格式
- 错误信息 plain text，前缀 `Error: `
- 进度信息不输出或输出到 stderr

**示例**:

```bash
$ pgyer apps list
{"apps":[{"name":"MyApp","bundleId":"com.example.app","appKey":"abc123"}]}

$ pgyer auth status
{"loggedIn":true,"user":"test@example.com"}

$ pgyer apps info invalid
Error: App not found
```

## Human 模式 (`--human` / `-H`)

**特点**:

- 启用 picocolors 颜色输出
- 启用 ora 加载动画
- 表格格式化、对齐（可用 cli-table3）
- 友好的提示信息、emoji

**示例**:

```bash
$ pgyer apps list --human
✔ Found 2 apps

┌─────────┬────────────────────┬──────────┐
│ Name    │ Bundle ID          │ App Key  │
├─────────┼────────────────────┼──────────┤
│ MyApp   │ com.example.app    │ abc123   │
│ DemoApp │ com.example.demo   │ def456   │
└─────────┴────────────────────┴──────────┘

$ pgyer auth status --human
✔ Logged in as test@example.com
```

## 实现要点

```typescript
// utils/logger.ts
interface Logger {
  json(data: unknown): void;      // JSON 输出
  text(message: string): void;    // 文本输出
  error(message: string): void;   // 错误输出
  table(data: unknown[]): void;   // 表格输出 (仅 human)
  success(message: string): void; // 成功提示 (仅 human)
}

// 全局状态
let isHumanMode = false;

export function setHumanMode(enabled: boolean) {
  isHumanMode = enabled;
}

export function createLogger(): Logger {
  if (isHumanMode) {
    return new HumanLogger();
  }
  return new JsonLogger();
}
```

## 选项冲突处理

- `--json` 强制 JSON 输出（即使配置文件指定 text）
- `--human` 与 `--json` 同时指定时，`--human` 优先
