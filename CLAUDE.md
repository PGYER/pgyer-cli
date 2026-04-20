# Pgyer CLI 架构与开发规范

## 1. 项目概述

基于 Node.js + TypeScript 的全局 CLI 工具，支持 `npm i -g @pgyer/cli` 和 `npx @pgyer/cli`。

**设计原则**：默认 LLM 友好输出（无颜色、JSON），`--human` / `-H` 启用人性化输出。

## 2. 开发流程

**重要**: 任何技术改动前，必须先更新 [doc/spec/](doc/spec/) 目录下的技术设计文档，再进行代码修改。

详细技术设计见 `doc/TECH_SPEC.md`。

## 2. 技术栈

- **语言/打包**: TypeScript (strict) + tsup (CJS 单文件输出)
- **CLI 框架**: `cac`
- **UI**: `picocolors`, `ora` (仅 `--human` 模式)
- **配置**: 自定义实现，存储至 `~/.config/pgyer/config.json`
- **授权**: `open` + Node `http` (本地回调服务器)
- **网络**: 原生 `fetch` (自动注入 Token)

## 3. 目录结构

```text
src/
├── index.ts                 # CLI 入口
├── commands/
│   ├── auth/                # login, logout, status, token
│   ├── apps/                # list, info, delete
│   └── upload/              # upload (独立模块)
├── core/
│   ├── config.ts            # 配置管理
│   ├── env.ts               # 环境变量解析
│   └── api.ts               # 网络请求封装
└── utils/
    ├── logger.ts            # 输出工具 (JSON/Human)
    └── spinner.ts           # ora 封装
```

## 4. 配置

**优先级**: CLI 参数 > 环境变量 > 配置文件

**环境变量**: `PGYER_API_KEY`, `PGYER_OUTPUT_FORMAT`

**配置文件** (`~/.config/pgyer/config.json`):

```json
{ "apiKey": "xxx", "apiUrl": "https://api.pgyer.com", "outputFormat": "json" }
```

## 5. 命令

```bash
pgyer auth login/logout/status/token
pgyer apps list/info <appKey>/delete <appKey>
pgyer upload <file>

# 全局选项: --human/-H, --json, --help
```

## 6. 核心逻辑

**auth login**: 本地 HTTP 服务器 (端口 3456 起自动探测可用端口) → 浏览器授权 → 回调 `/?auth=<base64url>` (JSON: `{ ukey, name, apikey }`) → 保存并关闭。

**构建**: `bin: {"pgyer": "./dist/index.js"}`, tsup 开启 minify + bundle。
