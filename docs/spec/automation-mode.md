# Human 与 JSON 自动化模式

CLI 同时服务真人终端用户、传统 Shell 脚本和 AI Agent。本规范定义两种兼容模式，不要求所有成功命令使用相同 envelope。

## Human 模式

- 默认启用，真人和 AI Agent 共用这套清晰、简洁的输出
- 也可显式使用 `--human`
- 允许颜色、spinner、表格和交互确认
- 面向真人阅读，但字段名称和信息层级应保持清晰，方便 Agent 理解

## JSON 模式

- 仅在显式使用 `--json` 时启用
- 每个命令返回适合自身语义的 JSON，不强制包裹统一 `data` 字段
- 禁止颜色、spinner 和交互确认
- stdout 只输出最终成功结果，错误 JSON 写入 stderr
- 需要确认的操作必须显式使用 `--force`

错误结构保持统一：

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

## 子命令边界

`auth`、`apps` 和 `versions` 的每个动作注册为独立命令，使 `--help` 只展示该动作可以使用的参数。未知或不适用参数必须失败，不能静默忽略。

## 非交互安全

- `--json` 或无输入 TTY 时绝不显示输入提示
- 删除等不可恢复操作必须显式 `--force`
- 状态修改命令支持 `--dry-run`，返回计划但不调用修改 API
- `--dry-run` 不要求 `--force`

## 异步上传闭环

```bash
pgyer upload <file> --no-wait --json
pgyer uploads status <uploadKey> --json
pgyer uploads wait <uploadKey> --timeout 600 --json
```

`status` 只查询一次；解析中返回 `status=pending`。`wait` 按轮询间隔（默认 3 秒）等待成功、失败或超时（默认 600 秒）；等待期间的网络错误会重试到超时为止。

## 密钥与密码

- API Key 推荐通过 `PGYER_API_KEY` 注入
- 安装密码推荐通过 `--password-env <name>` 读取，默认变量为 `PGYER_INSTALL_PASSWORD`
- `auth token` 默认只显示脱敏 Token；完整值要求显式 `--reveal`
- 成功、错误和调试输出不得包含 API Key、安装密码、COS 签名或临时凭证
- API Key 只放在 POST 正文中，不得出现在任何 URL 里
