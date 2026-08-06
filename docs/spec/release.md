# 发布流程设计

## 触发策略

push 到 `main` 分支时自动构建并发布到 npm。若 `package.json` 中的版本号已在 npm 上存在，则跳过本次发布（不视为失败）。

## 工作流

**文件**: `.github/workflows/publish.yml`

**触发**: `push` 到 `main` 分支，或手动触发（`workflow_dispatch`）

**流程**:

1. Checkout 代码
2. Setup Node（含 npm registry 配置）
3. 读取 `package.json` 版本号，与 npm 已发布版本比对
4. 若版本已存在 → 跳过发布（输出 notice）
5. 若版本不存在 → `npm ci` → `npm run build` → `npm publish --access public`

## 所需密钥

| 密钥名 | 用途 | 配置位置 |
|--------|------|----------|
| `NPM_TOKEN` | npm 发布令牌 | GitHub 仓库 Settings → Secrets and variables → Actions |

## 发布步骤

1. 修改 `package.json` 中的 `version`
2. 提交并 push 到 `main`
3. GitHub Actions 自动构建并发布
4. 若未改版本号，本次 push 自动跳过发布

## 依赖与构建

- 依赖安装: `npm ci`（基于 `package-lock.json`）
- 构建: `tsup`（`npm run build`），产物在 `dist/`
- 发布前 `prepublishOnly` 钩子也会触发构建（双重保障）
