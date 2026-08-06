# API 2.0 能力扩展

本文定义本轮 API 2.0 扩展的范围与命令行为。未列出的 API 分组不在本轮实现范围内。

## 范围

本轮实现：

- 新版快速上传：获取 COS 凭证、流式上传、轮询发布结果
- IPA、APK、HAP 文件类型
- 应用列表分页、指定版本详情、短链接查询、应用设置
- 版本列表、设置/取消最新版、检测更新、删除指定版本

本轮不实现：

- 应用分组
- 反馈信息
- 证书过期检查
- 安装链接、二维码辅助能力

## 快速上传

`pgyer upload <file>` 默认等待应用解析完成，以保持现有命令的成功语义。

流程：

1. 根据扩展名生成 `buildType`：`.ipa=ios`、`.apk=android`、`.hap=harmonyos`
2. 调用 `POST /apiv2/app/getCOSToken`
3. 使用文件流向响应中的 `endpoint` 上传 multipart/form-data
4. 仅将 HTTP 204 视为存储上传成功
5. 调用 `GET /apiv2/app/buildInfo`，遇到 `code=1247` 或成功响应中的 `buildBuildVersion=0` 时继续轮询
6. 返回已发布版本信息；其他非零 code 立即失败

新增选项：

- `--description <text>`：应用介绍
- `--upload-region <auto|overseas|domestic>`：上传区域，分别对应留空、`oversea=1`、`oversea=2`
- `--timeout <seconds>`：整个上传与解析流程的最大等待时间，默认 300 秒
- `--poll-interval <seconds>`：解析状态轮询间隔，默认 4 秒
- `--no-wait`：文件上传成功后立即返回上传 key，不等待解析
- `--password-env [name]`：从环境变量读取安装密码；不指定名称时使用 `PGYER_INSTALL_PASSWORD`

兼容保留现有发布参数：安装密码、邀请安装、有效期、更新说明和渠道短链接。`--app-key` 不属于新版快速上传 API 参数，保留参数解析但明确报错，避免静默忽略用户意图。

## 应用管理

```bash
pgyer apps list [--page <number>] [--all]
pgyer apps info <appKey> [--build <buildKey>]
pgyer apps resolve <shortcut>
pgyer apps update <appKey> [settings]
pgyer apps delete <appKey> --force
```

`apps update` 支持短链接、安装方式/密码、有效期、语言、版本号来源、自动同步和版权显示。命令先读取当前 App 信息，再把未指定字段按当前值回填，避免部分修改清空已有设置。历史 `buildTemplate` 字段不对外提供，因为当前下载页只有一种样式。

应用删除在所有输出模式下均要求交互确认或显式 `--force`，JSON 模式不再隐式跳过确认。

## 版本管理

```bash
pgyer versions list <appKey> [--page <number>] [--all]
pgyer versions set-latest <buildKey>
pgyer versions unset-latest <buildKey>
pgyer versions check <appKey> [--current-version <version>] [--build-version <number>] [--channel <key>]
pgyer versions delete <buildKey> --force
```

设置/取消最新版属于发布状态变更；删除版本不可恢复。删除在所有输出模式下均要求交互确认或显式 `--force`。

所有修改和删除命令支持 `--dry-run`，只返回计划，不执行远端修改。

## 输出与退出码

- 非 Human 模式只在 stdout 输出最终 JSON，过程信息写入 stderr
- Human 模式使用 spinner、表格和可读摘要
- API 错误、校验错误、上传超时和用户取消均返回非零退出码
- `--all` 会顺序读取全部分页；不与 `--page` 同时使用
