# 发布、收录与升级指南

本指南区分四个独立环节：**本地仓库准备 → GitHub 托管 → 可安装分发源 → DSH 市场索引收录**。GitHub 上传不等于 npm 发布；npm 发布也不等于市场可搜索。市场支持 git 分发源，因此 npm 不是所有收录路径的硬性前置条件。

当前 [package.json](<../package.json>) 的版本为 `0.1.0`。本指南说明可重复的发布流程，不凭文档日期推定 GitHub 上传、npm 发布、市场收录或真实 profile 安装已完成。

## 1. 发布目标与完成证据

- 公开 GitHub 仓库：[wxid123/XieHome](https://github.com/wxid123/XieHome)，保留仓库名称和已有提交历史。
- npm 分发目标：`dsh-preset-conductor@0.1.0`，registry 为 <https://registry.npmjs.org/>，按公开包发布。
- 许可：[MIT](<../LICENSE>)，覆盖本项目代码、文档与原创[图标](<../icon.svg>)。

| 环节 | 需要核验的条件 | 完成证据 |
| --- | --- | --- |
| 本地准备 | 两份独立预设、生成物、测试、分发资源一致 | 实际检查与打包记录 |
| GitHub | 目标仓库、remote、分支、git 身份及认证正确，保留远端历史 | 远端对应 commit 可见 |
| npm | 预期账户、发布权限、2FA、未占用版本号及已核验实包 | registry 中可取到正确版本的包 |
| DSH 市场 | 目标索引接受投稿、符合其 schema 与审核流程 | 索引维护者完成收录，实际搜索返回条目 |
| profile 安装 | 独立安装阶段、可用 Host 与目标分发源 | `application` 结果及新会话功能验收 |

提交、推送和 npm 发布按下述流程完成并验证；不要把本地检查通过等同于远端已发布。真实 DSH 安装是独立兼容性验收，不是 npm 接收包的技术前置条件，也不随 GitHub / npm 发布自动执行。

## 2. 本地发布前检查

### 配置与版本

- `conductor` 与 `conductor-child` 是固定 id，分别维护[主配置](<../presets/conductor/agent.cordis.yml>)和[子配置](<../presets/conductor-child/agent.cordis.yml>)，并分别维护[主元数据](<../presets/conductor/preset.yml>)和[子元数据](<../presets/conductor-child/preset.yml>)。
- [bundle patch](<../cordis.patch.yml>) 必须由[合成脚本](<../scripts/compose-bundle-patch.mjs>)生成，先声明 child，再声明引用它的 parent。展示顺序仍由各自的 `order` 决定。
- [旧 derive-child 入口](<../scripts/derive-child.mjs>) 仅校验，不再写入子配置；父子差异不是错误，除非违反了各自明确的结构约定。
- 发布前更新 [Changelog](<../CHANGELOG.md>)，确认 [package.json](<../package.json>) 与发布产物中的版本一致。本次首发版本为 `0.1.0`；发布状态以 registry 为准。
- `repository`、`homepage`、`bugs` 应指向真实的 [XieHome 仓库](https://github.com/wxid123/XieHome)及其页面，`publishConfig` 应与目标 registry 和公开分发方式一致。
- Node.js ≥ 20 是开发脚本要求。DSH 最低版本须依据实际测试矩阵确定，不从 Node.js 版本推导，也不填未经验证的 `engines.dsh`。

### 开发与打包

在开发环境中使用锁文件准备开发依赖，再合成与检查：

```bash
npm ci
npm run compose
npm test
npm run check
```

`yaml` 为开发依赖，bundle 无运行时依赖。[package.json](<../package.json>) 中的 `check`、`prepack` 与 `prepublishOnly` 共享同一检查门禁；本地通过与 CI 配置存在是两件事，应保留实际执行结果。

`npm run check:package` 无参数时仅检查源文件清单，输出会明确标注 `archive not inspected`；这不构成实包检查。应再生成**真正的 tarball**并传给检查器。标准 npm 环境可运行：

```bash
npm run check:package
npm pack --pack-destination artifacts
npm run check:package -- --packed-dir artifacts
```

`--packed-dir` 按 [package.json](<../package.json>) 当前名称 / 版本定位该目录的 tarball；也可用 `npm run check:package -- --tarball PATH_TO_TARBALL` 明确指定。实包检查需要本机 `tar` 命令（本项目 CI 的 Ubuntu / Windows runner 提供）；检查器只读列出和读取 tarball，不解压到磁盘，也不执行包中代码。Windows 使用相对归档文件名，避免 GNU tar 将盘符误当远程主机。CI 使用同样的实包检查路线。打包会生成本地产物。确保包中至少包含：

- [manifest](<../package.json>)、[bundle patch](<../cordis.patch.yml>)、两套预设源和声明的构建脚本。
- [README](<../README.md>)、[Changelog](<../CHANGELOG.md>)、本[发布指南](<PUBLISHING.md>)与 [MIT 许可](<../LICENSE>)。
- [英文 locale](<../locale/en.json>)、[中文 locale](<../locale/zh.json>)和[原创 SVG 图标](<../icon.svg>)。

显示资源使用经技能文档核验的 manifest 导出形式；如另有运行时导出，必须保留：

```json
{
  "exports": {
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  }
}
```

`files` 应包含 locale、文档和图标，以及 bundle 所需文件。locale 的 `meta.title` / `meta.description` 应准确描述本 bundle。图标为本项目原创，随 [MIT 许可](<../LICENSE>)分发；格式须有效、位于包内，大小上限为 256 KiB。静态格式检查不等于界面已渲染通过。

若检查后又修改了源文件、文档或 manifest，应重新检查、重新打包并核对实包；发布对象必须是最终审查过的版本，而不是修改前的旧 tarball。

## 3. 上传 GitHub

上传目标是公开仓库 [wxid123/XieHome](https://github.com/wxid123/XieHome)。推送前核对：

1. **账户和权限**：使用对目标仓库具有写权限的真实 GitHub 账户。
2. **remote**：本地 `origin` 是否指向目标仓库；如已存在，先核对，不盲目替换。
3. **分支与历史**：使用实际分支和远端分支策略，不假设必为 `main`。保留远端已有的初始化提交；先获取并整合历史，再正常推送，不以强制推送替代历史整合。
4. **git 身份**：确认提交用的 `user.name` 与 `user.email`；邮箱会进入 commit 元数据。
5. **认证**：通过本机凭据管理器、浏览器流程或已配置的 SSH 完成。无需向文档或对话发送 token、密码或私钥。
6. **提交范围**：复查所有将提交的文件、差异和产物，排除凭据、本地缓存、依赖目录和非分发产物后提交。

可在本地只读检查这些仓库事实：

```bash
git status --short
git remote -v
git branch --show-current
git config --get user.name
git config --get user.email
```

这些检查不证明远端写权限。完成认证与历史整合后，提交最终文件并推送实际分支，再核对远端仓库中的 commit 和文件内容。远端已有 README 时，应将项目说明整合为仓库 README，而不是覆盖仓库提交历史。

## 4. 发布 npm

即使 npm 账户已经注册，发布前仍需核验：

- 本机登录的是预期 npm 账户，且面向 <https://registry.npmjs.org/>。
- `dsh-preset-conductor` 的名称当前可用；若已存在，登录账户有该包的发布权限。名称存在或账户已登录，都不单独证明所有权。
- 账户 / 组织的 2FA 和发布认证要求已满足；在本机完成交互，不在文档或对话中填写凭据。
- `0.1.0` 在目标 registry 中尚未被占用。已发布的 npm 版本不作为覆盖上传目标；后续变更发布新版本。
- [manifest](<../package.json>)、许可、显示资源、生成物和最终 tarball 的检查已完成，发布内容不含本地凭据或与分发无关的产物。

标准 npm CLI 可先核对账户和目标版本：

```bash
npm whoami --registry https://registry.npmjs.org/
npm view dsh-preset-conductor@0.1.0 version dist.tarball dist.integrity --json --registry https://registry.npmjs.org/
```

查询返回未找到只说明该次查询未发现目标版本，不单独证明发布权限。尚未登录时，先在本机完成 `npm login --registry https://registry.npmjs.org/`，再核验预期账户。

在第 2 节的统一门禁、打包与最终实包检查通过后，发布**该已核验 tarball**：

```bash
npm publish ./artifacts/dsh-preset-conductor-0.1.0.tgz --registry https://registry.npmjs.org/ --access public
```

发布 tarball 时不要依赖工作区的生命周期钩子替代前述检查；检查和打包应已明确完成。发布后再次执行 `npm view`，确认 registry 返回 `0.1.0`、tarball 地址和 integrity；必要时核对可下载包与最终本地产物。只有 registry 可取到正确内容，才记录 npm 发布完成。

## 5. DSH 市场收录

### 已核验的本地配置与契约

2026-11-06 的本地 `plugin_market` → `list_indexes` 配置检查记录包含以下 URL；该记录不包含索引正文下载或收录验证：

- <https://realguan.github.io/dsh-plugin-market/dsh-index.json>
- <https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json>

它们是**当时配置的索引来源**，不代表来源此刻可用、接受何种投稿或已收录本包。其他用户的配置也可能不同。

`cordis_inspect_list` → Host `Service.listService` → `pluginMarket` 核验到以下服务契约结构（以 TypeScript 片段摘录表示）：

```ts
export type MarketSource = {
    readonly type: 'npm';
    readonly registry?: string;
} | {
    readonly type: 'git';
    readonly url: string;
    readonly commit: string;
    readonly path?: string;
};

export interface MarketVersion {
    readonly version: string;
    readonly publishTimestamp: number;
    readonly source: MarketSource;
    readonly engines: MarketEngines;
}

export interface MarketEngines {
    readonly dsh?: string;
}
```

该契约说明支持 npm 和带 commit 的 git 源；它**不是索引文件全文 schema，也不是投稿 PR 的文件模板**。市场查询返回的版本可带 `install.spec` 与可选 `install.registry`，安装时应使用实际返回值，而不是根据 GitHub 地址猜装包参数。

### 待目标市场维护者确认

以下内容尚未确认，投稿前应向目标索引维护者核验：

- 正式接受投稿的仓库、分支、PR 流程和目标文件路径。
- 索引文档的完整 schema / schema 版本，以及条目、分类、标签和图标的具体约束。
- `publishTimestamp` 的单位及有效值要求；git URL、commit、子目录的接收规则。
- 是否要求 npm 包、测试记录、兼容性声明或其他审核材料，以及收录后的发布 / 刷新流程。

不从配置 URL 推导一个未经确认的投稿仓库路径，不编造索引 JSON。待审核接受且实际索引搜索返回本包后，才可写“市场已收录”。仅有 GitHub 仓库或 npm 版本都不构成该证据。

## 6. 安装与手动升级

### 安装本地 checkout

这是独立安装阶段的 DSH `plugin_manager` 工具参数示例，不是已执行记录，也不是 shell 命令。安装会影响当前 profile 的所有会话；发布到 GitHub / npm 不会自动安装本 bundle。先读取安装清单获取现有标识，再使用真实目录替换占位路径：

```json
{ "action": "list_bundles" }
```

```json
{
  "action": "install_bundle",
  "target": "C:/ABSOLUTE_PATH/dsh-preset-conductor"
}
```

本地目录安装链接本地 checkout。`files` 不过滤一个被链接的本地目录，因此本地安装成功也不证明发布 tarball 完整。本地链接不监控 GitHub，不会因远端 push 自动更新。

### 手动升级到新版本 / 新 spec

1. 维护者先发布**新版本或新的可安装 spec**；npm 使用未占用的新版本，git 源明确新 commit。
2. 安装者读取实际 bundle / 市场版本信息，核对目标。来自市场时使用其实际 `install.spec` 和可选 `install.registry`。
3. 通过 `plugin_manager` 的 `install_bundle` 安装确定的 spec。例如仅在该 npm 版本已发布后使用：

   ```json
   {
     "action": "install_bundle",
     "target": "dsh-preset-conductor@<PUBLISHED_VERSION>"
   }
   ```

4. 检查 `application`、`warnings`、错误和可能的 `nextStep`。`applied` 仍需行为验证；`restart-required` 按原因重启 Host；`overridden`、`failed`、`cancelled` 不记作升级通过。有 `pendingBuilds` 时，先处理相应脚本执行确认，不预先填批准清单。
5. 重启要求处理完后，开**新会话**选择 `conductor`，重新验收。已有会话及其子代理保留旧 revision。

修改本地源码时，先重新合成并检查，再通过 bundle 管理应用；不要把手改 profile 补丁作为标准升级路径。本指南不承诺未经核验的 `dsh plugin update` 命令或某个 GUI 更新按钮。

## 7. 真实 profile 验收清单（尚待执行）

- [ ] 记录目标 DSH 版本、profile、来源 spec、包版本和安装结果；没有最低版本结论时不补猜测值。
- [ ] 两个声明正常注册，`conductor-child` 先于父声明加载，无 `broken` / 激活失败诊断。
- [ ] 新会话选择 `conductor`，检查 persona、基础工具和计划工具的实际可用性。
- [ ] 通过父预设的 spawn 路径启动子任务，核对实际预设为 `conductor-child`，并检查其实际工具列表。
- [ ] 分别验证 fork / workflow / ralph 的组合与深度；不从 spawn 的映射推导所有子链都受 child 配置约束。
- [ ] 按目标 Host 验证长期 goal 与可选后端；测试期间改变的用户状态按既定验收方案还原。
- [ ] 中英文 bundle 标题、说明、图标实际渲染正确；区分 bundle 自有资源与其引用插件行的资源，检查诊断和非预期回退。
- [ ] 安装发布 tarball 或 registry / git 分发源后重复核心验收，确认不是只在本地链接目录中成立。

[README](<../README.md>) 说明使用与维护入口；[Changelog](<../CHANGELOG.md>) 记录版本变更。真实安装、对外发布和市场收录结果应分别记录，不互相替代。
