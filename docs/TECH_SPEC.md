# 技术设计规范

本文档定义 pgyer-cli 的详细技术设计，任何代码改动前需先更新此文档。

## 目录

- [配置管理](./spec/config.md) - 配置来源、优先级、环境变量
- [输出模式](./spec/output.md) - LLM 友好输出、Human 模式
- [模块设计](./spec/modules.md) - auth、apps、upload 模块详细设计
- [API 规范](./spec/api.md) - 网络请求封装与 API 接口
- [API 2.0 能力扩展](./spec/api2-expansion.md) - 快速上传、版本管理与应用设置
- [Human 与 JSON 自动化模式](./spec/automation-mode.md) - 输出协议与非交互安全
- [发布流程](./spec/release.md) - GitHub Actions 自动发布到 npm
