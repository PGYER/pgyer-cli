# 发布流程设计

## 触发策略

push 到 `main` 或提交针对 `main` 的 Pull Request 时执行质量检查，不发布。推送与 `package.json` 版本匹配的 `v*` 标签时自动发布到 npm，也可手动触发。若当前版本已在 npm 上存在，则跳过发布（不视为失败）。

所有 CI/发布运行使用同一并发组串行执行，避免多个版本同时更新 npm `latest` 标签。

## 工作流

**文件**: `.github/workflows/publish.yml`

**触发**: `push` 到 `main`、针对 `main` 的 Pull Request、推送 `v*` 标签，或手动触发（`workflow_dispatch`）

**流程**:

1. Checkout 代码
2. Setup Node（含 npm registry 配置）
3. `npm ci` 安装锁定依赖
4. 执行类型检查、测试和构建
5. 将 npm 包打成 `.tgz`，隔离安装后验证 `pgyer --version` 和 `pgyer --help`
6. 若为 `main` push 或 Pull Request → 到此结束，不发布
7. 若为标签发布，验证标签必须等于 `v<package.json version>`
8. 读取 `package.json` 版本号，与 npm 已发布版本比对
9. 若版本已存在 → 跳过发布（输出 notice）
10. 若版本不存在 → `npm publish --access public`

## 所需密钥

| 密钥名 | 用途 | 配置位置 |
|--------|------|----------|
| `NPM_TOKEN` | npm 发布令牌 | GitHub 仓库 Settings → Secrets and variables → Actions |

## 发布步骤

1. 修改 `package.json` 和 `package-lock.json` 中的 `version`
2. 提交并 push 到 `main`，等待 CI 通过
3. 创建与版本一致的标签，例如 `v0.2.0`
4. 推送标签，GitHub Actions 自动构建并发布

## 依赖与构建

- 依赖安装: `npm ci`（基于 `package-lock.json`）
- 类型检查: `npm run typecheck`
- 测试: `npm test`（使用 GitHub Runner 的隔离临时主目录）
- 构建: `tsup`（`npm run build`），产物在 `dist/`：`index.js`（CLI）与 `mcp.js`（`@pgyer/cli/mcp` 导出，供 `pgyer-mcp-server` 调用）
- 包冒烟测试: `npm pack` 后隔离安装，验证 CLI 版本与帮助输出
- 每次 push、Pull Request、标签和手动触发都会执行上述质量检查；只有标签或手动触发且 npm 上不存在当前版本时才发布
- 发布前 `prepublishOnly` 钩子也会触发构建（双重保障）

## pgyer-mcp-server

`pgyer-mcp-server` 2.x 依赖 `@pgyer/cli` 并调用 `@pgyer/cli/mcp`。先发布 `@pgyer/cli`，再发布 `pgyer-mcp-server` 并更新 MCP Registry（步骤见该仓库 README）。
