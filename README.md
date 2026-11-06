# XieHome · dsh-preset-conductor

> Two independently maintained DSH presets for explicit planning and task delegation.

[GitHub 仓库：wxid123/XieHome](https://github.com/wxid123/XieHome) · npm 包名：`dsh-preset-conductor` · MIT

DSH（DeepSeek Harness）的「编排模式（Conductor）」预设 bundle，通过 persona 引导模型先记录计划、并行处理独立任务，并管理跨轮目标。**这些是工作方式指引，不是模型行为或所有委派路径的强制保证。**

当前版本为 `0.1.0`，见 [package.json](<package.json>)。GitHub 与 npm 的发布结果以相应远端可见内容为准；真实 profile 安装和市场收录仍待独立验收。发布流程、升级方式和待验收项见[发布指南](<docs/PUBLISHING.md>)。

## 两个独立维护的预设

| 预设 id（稳定契约） | Loader 行 id | 用途 | 展示顺序 |
| --- | --- | --- | --- |
| `conductor` | `preset-conductor` | 主会话编排，包含 spawn / fork / workflow / ralph 的相应配置 | `21` |
| `conductor-child` | `preset-conductor-child` | 面向子任务的独立配置，省略 `subagent_fork` / `workflow` / `ralph` 工具行 | `21.1` |

两个预设的插件列表与元数据分别维护，**没有父 → 子自动派生，也不要求插件行序列强制同源**。需要同时调整的共享设置，请分别审查两份配置。

父预设的 spawn 配置显式指定：

```yaml
provider: spawn
toolName: subagent
maxDepth: 1
agentPreset: conductor-child
```

这条映射只说明该 `subagent` spawn 路径选择 `conductor-child`。父预设中的 `subagent_fork`、`workflow`、`ralph` 没有因此全部改用子预设；它们的实际组合、后端和深度限制须分别验收。子预设仍有自己的 `subagent` 配置，`maxDepth: 1` 也不是覆盖所有后端的全局限制。因此本 bundle 不承诺“所有子代理都是叶子节点”。

[生成的 bundle patch](<cordis.patch.yml>) 先声明 `conductor-child`，再声明引用它的 `conductor`；声明顺序与上表的展示顺序是两件事。两个 id 保持固定，升级时不通过改 id 替换已有预设。

## 编排指引

[主预设 persona](<presets/conductor/agent.cordis.yml>) 根据可观测特征引导模型规划，例如：涉及多个文件或模块、先探索未知代码、存在多个独立子问题、需要跨轮推进。

核心约定包括：

- 用 `todo_write` 记录多步任务，并随完成情况更新。
- 独立子问题同批委派，同批上限 4 个；有输入依赖的任务串行执行。
- 一次读文件、一次搜索或一条命令能完成的工作由当前代理直接做。
- 委派说明写全目标、背景、输入、约束、验收和输出要求。
- 派发后继续推进本地工作，收回结果后记录结论与决策。
- 真正需要跨轮执行的长期目标使用 goal 工具；遵循当前工具契约和宿主限制。

[子预设 persona 与插件列表](<presets/conductor-child/agent.cordis.yml>) 可独立调整。persona 文本不代替实际的工具注册、权限、后端能力或运行时校验。

## 维护与本地检查

维护入口：

| 内容 | 主预设 | 子预设 |
| --- | --- | --- |
| 显示名称、说明、order | [主元数据](<presets/conductor/preset.yml>) | [子元数据](<presets/conductor-child/preset.yml>) |
| persona 与插件列表 | [主插件列表](<presets/conductor/agent.cordis.yml>) | [子插件列表](<presets/conductor-child/agent.cordis.yml>) |

开发脚本要求 Node.js ≥ 20，并使用锁定的 `yaml` 开发依赖；bundle 没有运行时依赖。Node.js 要求不代表 DSH 最低版本。首次准备开发环境后，标准流程为：

```bash
npm ci
npm run compose
npm test
npm run check
npm run check:package
npm pack --pack-destination artifacts
npm run check:package -- --packed-dir artifacts
```

- `compose` 从两份独立源配置合成 [bundle patch](<cordis.patch.yml>)，保留 Loader 的 `!!js` 表达式；不生成或覆盖子预设源文件。
- `check` 校验配置与提交的生成物；`prepack`、`prepublishOnly` 使用同一检查门禁。
- `check:package` 无参数只检查源清单，并标注 `archive not inspected`；打包后加 `--packed-dir artifacts` 才检查实际 tarball。也可用 `--tarball PATH_TO_TARBALL`，详情见[发布指南](<docs/PUBLISHING.md>)。
- 旧的 [derive-child.mjs](<scripts/derive-child.mjs>) 仅保留为**只读校验兼容入口**；直接执行或加 `--check` 都不再写入子预设。
- [合成脚本](<scripts/compose-bundle-patch.mjs>) 是生成 [bundle patch](<cordis.patch.yml>) 的入口；请修改源配置后重新合成，而不是手改生成物。

预构建 bundle 的使用者无需为使用预设安装 `yaml`；维护和重新合成时才需要开发依赖。具体脚本定义以 [package.json](<package.json>) 为准。

## 安装与独立验收

以下是已核验的 DSH `plugin_manager` 工具参数示例，**不是 shell 命令**。本项目尚未完成真实 profile 安装验收。安装会影响当前 profile 的所有会话，属于独立安装阶段；GitHub / npm 发布不会自动安装插件或修改 profile。

先查看 bundle 清单，再安装本地目录；将示例目录替换为真实绝对路径：

```json
{ "action": "list_bundles" }
```

```json
{
  "action": "install_bundle",
  "target": "C:/ABSOLUTE_PATH/dsh-preset-conductor"
}
```

安装后检查返回的 `application`、`warnings` 和可能的 `nextStep`：

- `applied` 表示配置已应用，仍需验证预设与工具行为。
- `restart-required` 表示按返回原因重启 Host 后再验收。
- `overridden`、`failed`、`cancelled` 应按诊断处理，不记作安装通过。

声明正常后，在**新会话**中选择 `conductor`。已有会话和它们的子代理保留启动时的预设 revision；不要用旧会话证明升级已生效。常规安装和升级走 bundle 管理，不要求手写 profile 补丁或修改默认预设。

本地目录安装链接本地 checkout，既不跟踪 GitHub 更新，也不自动拉取发布版本。GitHub、npm、市场索引和手动升级是不同环节，详见[发布指南](<docs/PUBLISHING.md>)；本文不承诺未经核验的更新 CLI 或 GUI 按钮。

## 兼容性与验收边界

已核验的接口与静态约定：

- bundle 入口由 [package.json](<package.json>) 的 `dsh.bundle.patch` 指定。
- 当前 Inspect 中的 agent preset 声明要求 `id` 与 `plugins`，可含 `name`、`description`、`order`。
- 源配置使用 Cordis Loader 的 `!!js`；它不是普通 YAML 字符串的运行时执行结果。
- 父 spawn 映射到 `conductor-child`，不使用已废弃的 `toolFilter` 作为子工具过滤方案。
- [英文资源](<locale/en.json>)、[中文资源](<locale/zh.json>) 和[原创图标](<icon.svg>) 随包提供；界面实际展示仍需安装后检查。

仍待真实 profile 验收：

- 两个预设的注册状态、诊断以及新会话选择结果。
- spawn 子会话的实际预设与工具列表；fork / workflow / ralph 各自的行为。
- 深度限制、跨轮 goal、可选后端与 Host 服务是否按目标环境生效。
- 中英文显示资源和图标的实际渲染、是否发生非预期回退。
- 明确测试过的 DSH 版本矩阵；目前没有据此声明最低 DSH 版本。

本地测试和打包结果应以实际执行记录为准；存在 CI 配置不等于安装或市场验收已通过。

## 发布与许可

GitHub 目标为 [wxid123/XieHome](https://github.com/wxid123/XieHome)，npm 分发目标为 `dsh-preset-conductor@0.1.0`。提交推送、npm 发布与市场投稿分别依照[发布指南](<docs/PUBLISHING.md>)执行，并用远端 commit、registry 版本和实际市场查询分别确认；本地检查通过不表示这些步骤已经完成。

代码、文档与原创[图标](<icon.svg>) 使用 [MIT License](<LICENSE>)。版本变更见 [Changelog](<CHANGELOG.md>)。
