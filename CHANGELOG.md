# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.1.0] — 2026-11-06

首次公开分发版本，包名为 `dsh-preset-conductor`，GitHub 仓库为 [wxid123/XieHome](https://github.com/wxid123/XieHome)。本节记录 `0.1.0` 的首发内容；GitHub 推送与 npm 发布是否完成，以远端提交和 registry 的实际记录为准，不代替市场收录或真实 profile 安装验收。

### Added

- 两个固定 id 的预设：`conductor` 用于主会话编排，`conductor-child` 面向子任务；[主配置](<presets/conductor/agent.cordis.yml>)与[子配置](<presets/conductor-child/agent.cordis.yml>)独立维护。
- [合成脚本](<scripts/compose-bundle-patch.mjs>)将两套源配置合成 [bundle patch](<cordis.patch.yml>)，使用 `yaml` 开发依赖解析与校验，并保留 Loader 的 `!!js` 表达式。
- 本地测试与 CI 检查门禁；标准开发流程为 `npm ci`、`npm run compose`、`npm test`、`npm run check`，另有 `npm run check:package` 核对源清单，配合 `--packed-dir` / `--tarball` 检查实际分发包。脚本定义见 [package.json](<package.json>)。
- [英文](<locale/en.json>)和[中文](<locale/zh.json>)显示资源，以及随 [MIT 许可](<LICENSE>)分发的原创[指挥棒 / 编排节点图标](<icon.svg>)。
- [发布指南](<docs/PUBLISHING.md>)：区分 GitHub 托管、npm 发布、DSH 市场收录与手动升级，列出前置条件和安装后验收步骤。

### Changed

- 取消“父预设是唯一真源”和父 → 子自动派生；不再用父子插件行序列强制相同作为维护约束。
- [旧 derive-child 入口](<scripts/derive-child.mjs>)改为只读校验兼容入口，不再写入子预设。
- [bundle patch](<cordis.patch.yml>)先声明 `conductor-child`，再声明引用它的 `conductor`；两个预设 id 保持稳定。
- 保留父 spawn 配置的 `agentPreset: conductor-child` 映射，但明确 fork / workflow / ralph 不因此全部受 child 配置约束；不再承诺所有子代理都是叶子节点。
- [README](<README.md>)取消“市场已收录”、默认手改 profile、未经核验的 CLI / GUI 安装承诺；常规安装与升级使用 bundle 管理，并观察 `application` 与重启要求。
- `prepack` 与 `prepublishOnly` 共用检查门禁，避免发布跳过生成物和资源校验。

### Verification notes

- 发布准备检查已通过本地 112 项测试及包含 19 个文件的实际 tarball 校验；最终发布前应对最后修改重新检查与打包。这些是本地记录，不表示 GitHub Actions 已运行。
- 尚未安装 bundle 或修改 profile；真实 profile 的注册、运行行为、中英文显示和图标渲染仍按[发布指南中的清单](<docs/PUBLISHING.md#7-真实-profile-验收清单尚待执行>)验收。
- 尚未声明最低 DSH 版本；npm 发布权限与版本状态以实际 registry 检查为准，市场投稿 schema / PR 路径仍待目标维护者确认。
