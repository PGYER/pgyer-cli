# 输出模式设计

## 设计原则

CLI 工具需要同时支持两种使用场景：

1. **真人与 AI Agent** — 默认共用清晰、简洁的人类可读输出
2. **严格脚本解析** — 显式 `--json`，输出稳定的 JSON

## 默认模式（人类可读、Agent 可理解）

**特点**:

- 字段名称明确、层级简洁，避免无意义装饰和冗余文案
- 终端支持时可以使用颜色、动画和表格
- 错误写入 stderr，并使用非零退出码
- 无输入 TTY 时不得请求交互确认

**示例**:

```bash
$ pgyer auth status
✔ Logged in as test@example.com

$ pgyer apps info invalid
Error: App not found
```

## JSON 模式 (`--json`)

**特点**:

- 无颜色、无动画、无交互
- 成功结果以命令自身的 JSON 结构写入 stdout
- 错误以统一错误对象写入 stderr
- 不强制所有成功结果使用统一 envelope

**示例**:

```bash
$ pgyer auth status --json
{"loggedIn":true,"user":"test@example.com"}
```

## 实现要点

```typescript
// utils/logger.ts
interface Logger {
  json(data: unknown): void;      // JSON 输出
  text(message: string): void;    // 文本输出
  error(message: string): void;   // 错误输出
  table(data: Record<string, unknown>[]): void;   // 表格输出 (仅 human)
  success(message: string): void; // 成功提示 (仅 human)
  info(message: string): void;    // 信息提示
}

// 全局状态
let outputMode: 'human' | 'json' = 'human';

export function setOutputMode(mode: 'human' | 'json') {
  outputMode = mode;
}

export function createLogger(): Logger {
  if (outputMode === 'human') {
    return new HumanLogger();
  }
  return new JsonLogger();
}
```

## 选项冲突处理

- `--human` 与 `--json` 同时指定时，`--human` 优先
- `--json` 强制 JSON 输出（即使配置文件指定 text）
- 未指定 `--human` 或 `--json` 时始终使用默认人类可读输出
- 优先级：`--human` > `--json` > 默认人类可读输出
