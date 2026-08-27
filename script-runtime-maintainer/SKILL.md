---
name: script-runtime-maintainer
description: 自动维护 Scripting 脚本的运行信息——把 script.json 的 author 统一填成用户作者信息（name=WWWeng🐝、email=skype-lavish-yeast@duck.com、homepage=https://github.com/vvvvvveng/Scripting-releases，从 config.json 读取；已有其他作者的脚本不动 author 内容）；每次对脚本做实质性修改后更新版本号到最终值。版本号由三组数字构成（主版本.次版本.修订号）：小改动（参数调整、注释修改、按钮重命名、增加小按钮等）默认升第三组（patch）；大改动（大功能新增、整个页面新生成的功能、多个小功能同时增加）优先第三组（patch）、合适才升第二组（minor）；第一组（major）尽可能别改动；纯微调（格式化/纯视觉等）不改版本号。创建新脚本或修改任何现有脚本后必须执行本 skill，且每次修改必须完整跑完整个维护流程（补全作者 → 清理远程资源链接时间戳 → 判定版本级别 → 更新到最终版本号 → 写入 .change_notes 修改说明 → 打 mark-agent-modified 标记），不得中途自动终止；维护流程对 script.json 只改 author/version/remoteResource.url（远程资源链接形如 https://raw.githubusercontent.com/.../xx.scripting?t=<时间戳> 的，自动去掉 ?t= 时间戳参数换成干净链接）；每次智能体修改脚本后，把本次修改说明以 .change_notes 文件形式写入被改脚本目录（供脚本管理工具自动备份随包带走、恢复时展示），并打 mark-agent-modified 标记让自动备份把该脚本识别为手动修改（所有被改脚本，不限于脚本管理工具）；但不得把本次修改说明自动填入脚本自身的更新页面/更新日志等数据（脚本自身更新日志仍由用户手动填写），操作结束后在对话中告知用户修改了什么是可以的。UI 样式与布局一律先参考 SwiftUI 的实现方式、再查 Scripting 对应的文档和 API，遵守 iOS 26 系统设计风格（统一按钮、SF Symbol、配色），同时必须兼容 iOS 18——iOS 18 不可用的特性改用兼容实现。
metadata:
  display_name: "脚本运行维护"
  last_updated: "2026-08-28 01:48:47"
  intent_patterns: "脚本运行维护, 填写作者, 更新版本号, 修改脚本后, 版本号, 三组数字, 第三组, 修订号, 主版本, 次版本, patch, minor, major, author, script.json, bump version, 改脚本, 升级版本, 小版本, 大版本, 跑到最终位置, 不要自动终止, 修改说明, .change_notes, change notes, 智能体修改标记, mark-agent-modified, 自动备份, 历史版本, 旧版本, ScriptBackups, 找旧版, 恢复版本, 查看历史版本"
  required_tools: "run_shell_command, file_tool"
---

# Purpose

每当用户让 agent **创建新脚本**或**修改现有脚本**（scripts/ 目录下的项目）时，必须维护 `script.json` 的元信息：

1. **作者信息**：`author` 统一为 `{ name: "WWWeng🐝", email: "skype-lavish-yeast@duck.com", homepage: "https://github.com/vvvvvveng/Scripting-releases" }`（从本 skill 的 `config.json` 读取，改作者只需改那里）。**若脚本已有其他作者（`author.name` 存在且 ≠ WWWeng🐝），不动 `author` 的任何内容（name/email/homepage 一律保留）。**
2. **版本号**：对脚本做了**实质性修改**后，更新版本号。版本号由**三组数字**构成（`主版本.次版本.修订号`，如 `1.2.3`）：**小改动**（参数调整、注释修改、按钮重命名、增加小按钮等）默认升**第三组**（patch）；**大改动**（大功能新增、整个页面新生成的功能、多个小功能同时增加）**优先第三组**（patch），合适才升**第二组**（minor）；**第一组**（major）**尽可能别改动**；纯微调（格式化/纯视觉等）不 bump。
3. **远程资源链接**：Scripting 应用里长按脚本设置的「远程资源链接」（即 `script.json` 的 `remoteResource.url`）如果带了防缓存的时间戳参数（形如 `https://raw.githubusercontent.com/vvvvvveng/Scripting-releases/main/🐝密码管理器.scripting?t=1787666102311`），**自动去掉 `?t=<时间戳>` 参数**，替换成干净链接（`https://raw.githubusercontent.com/vvvvvveng/Scripting-releases/main/🐝密码管理器.scripting`）。仅清理时间戳属于纯机械处理（微调），**不因此 bump 版本号**。

用户规则：**每次实质修改都更新版本号；三组数字默认从第三组开始动，小改动升第三组（patch），大改动优先第三组、合适才升第二组（minor），第一组（major）尽可能别动；微调就不改**。即：默认要 bump 且默认升第三组，只有命中微调豁免清单时才不改。**跑维护流程时，每完成一步都要用中文在对话里给用户一条中间进度回复**（做了什么、下一步是什么），不要等全部跑完才一次性汇报。

# 元信息位置

每个脚本项目目录下有 `script.json`，相关字段：

| 字段 | 说明 |
|------|------|
| `author` | `{ "name", "email", "homepage" }`，作者信息。缺失或为 `null` 时按 `config.json` 补全；已有其他作者（`name` ≠ WWWeng🐝）时不修改。 |
| `version` | 三组数字构成的版本号（主版本.次版本.修订号），如 `"1.0.0"`。实质修改后按决策树 bump：默认升第三组（patch），合适才升第二组（minor），第一组（major）尽可能别动。 |
| `remoteResource.url` | Scripting 应用里长按脚本设置的「远程资源链接」。如果带 `?t=<时间戳>` 参数（如 `https://raw.githubusercontent.com/.../xx.scripting?t=1787666102311`），自动去掉该参数，替换成干净链接。 |

# Instructions

## 0. 代码约定（创建/修改脚本时一律遵守）

- **不主动参考本地已存在的脚本**：除非用户特别交代要参考某个脚本，否则一律不要主动去参考、对比、模仿 scripts/ 目录下已存在的其他脚本（即被修改脚本之外的本地脚本项目）。只有用户明确要求参考时才参考。
- **全屏模态一律用 `overFullScreen`，不要用 `fullScreen`**：凡脚本里需要全屏呈现（`Navigation.present` 等模态）的地方，`modalPresentationStyle` 统一用 `"overFullScreen"`，不要使用 `"fullScreen"`。默认不写 `modalPresentationStyle` 时保持默认即可（如默认 sheet 行为），只有确实需要全屏覆盖时才显式写 `"overFullScreen"`。
- **样式与布局遵循 SwiftUI 实现方式 + iOS 系统设计风格，兼容 iOS 18**：写任何 UI（样式、布局、交互）时，① 先参考 SwiftUI 的实现方式和交互惯例（如 `List` / `Form` / `NavigationStack` / `.sheet` / 系统按钮 / 系统配色等惯用法），② 再查找 Scripting 对应的文档和 API 来落地，③ 遵守 iOS 26 的系统设计风格指引（Human Interface Guidelines），尽量使用系统统一的按钮、SF Symbol、系统配色，不要自造与系统风格不符的控件；但同时必须确保 iOS 18 能兼容——若某个 iOS 26 新特性/新 API/新样式在 iOS 18 上不可用，则改用 iOS 18 可用的兼容实现（条件判断、回退方案等），保证 iOS 18 上同样能正常显示与使用。

## 1. 创建新脚本时

写 `script.json` 时直接带上：

```json
{
  "name": "<脚本名>",
  "icon": "<SF Symbol>",
  "color": "<颜色>",
  "version": "1.0.0",
  "author": { "name": "WWWeng🐝", "email": "skype-lavish-yeast@duck.com", "homepage": "https://github.com/vvvvvveng/Scripting-releases" }
}
```

新脚本初始版本固定 `1.0.0`，不需要额外 bump。

## 2. 修改现有脚本后（每次修改脚本都执行）

**硬性规则：每次修改脚本后，必须完整跑完下面的维护流程，直到最终版本号更新完成，不得中途自动终止、不得提前结束、不得只做一半就停下。**

修改完代码后，按顺序一次性执行到底：

> **重要：跑维护流程时要在对话里用中文给中间进度回复**。每完成一步，就向用户用中文简要汇报你做了什么（例如「① 作者信息已补全为 WWWeng🐝…」「① 远程资源链接已去掉 ?t= 时间戳…」「② 判断为小改动，走 patch」「③ 版本号已从 1.0.0 升到 1.0.1」「④ 已核对最终版本号，流程跑完」）。要一口气把整条流程跑完，中途不停，但每一步做完都实时把该步结果用中文说给用户听，不要等全部结束才一次性汇报。

1. **补全作者名 + 清理远程资源链接时间戳**：运行
   ```bash
   scripting-ts run "<skill_dir>/scripts/maintain_meta.ts" --queryparameters '{"action":"check-author","project":"<脚本目录名>"}'
   ```
   脚本会把 `author` 补全为 `config.json` 中的完整作者信息（name=WWWeng🐝、email、homepage）。**若脚本已有其他作者（`author.name` 存在且 ≠ WWWeng🐝），脚本不会改动 `author` 的任何内容**（返回 `skippedOtherAuthor: true`）。

   同时，该命令会**顺带清理远程资源链接**：如果 `remoteResource.url`（Scripting 应用里长按脚本设置的「远程资源链接」）带了 `?t=<时间戳>` 参数（如 `https://raw.githubusercontent.com/vvvvvveng/Scripting-releases/main/🐝密码管理器.scripting?t=1787666102311`），自动去掉 `?t=` 参数，替换成干净链接（`https://raw.githubusercontent.com/vvvvvveng/Scripting-releases/main/🐝密码管理器.scripting`），返回 `updateUrlCleaned: true`。**这条清理与作者无关**：即使脚本属于其他作者（author 不动），远程链接照常清理。

2. **判断版本号怎么变**：对照下方「版本号决策树」，先判定属哪一类：
   - 微调 → **不 bump**
   - 小改动（参数调整 / 注释修改 / 按钮重命名 / 增加小按钮 / Bug 修复等）→ **第三组（patch）**，默认首选
   - 大改动（大功能新增 / 整个页面新生成的功能 / 多个小功能同时增加）→ **优先第三组（patch）**，合适才升 **第二组（minor）**
   - 破坏性变更 / 架构重构等 → **第一组（major）尽可能别动**

3. **更新版本号**：若判定需要 bump，运行
   ```bash
   scripting-ts run "<skill_dir>/scripts/maintain_meta.ts" --queryparameters '{"action":"bump","project":"<脚本目录名>","level":"patch|minor|major"}'
   ```
   或在 `script.json` 中直接改 `version` 字段（规则相同）。bump 时同样会**顺带清理** `remoteResource.url` 的 `?t=` 时间戳参数。

4. **验证跑到最终位置**：bump 后必须确认以下内容，确认完成前不得结束：
   - 重新读一遍 `script.json`，核实 `author` 已是完整作者信息（name=WWWeng🐝 + email/homepage；若该脚本属于其他作者则 author 保持原样未动）、`version` 已是本次判定对应的**最终版本号**；
   - 核实 `remoteResource.url` 已是干净链接（若原来带 `?t=<时间戳>` 参数，现在应已去掉）；
   - 如果后续还要继续修改脚本，则每完成一轮修改都要重新执行第 1～3 步，直到用户要求的全部修改做完、版本号停在最终值为止。

   4b. **写入修改说明（.change_notes）——所有被智能体修改的脚本**：本次修改说明以 `.change_notes` 文件形式写入被改脚本目录，供脚本管理工具自动备份时随包带走、恢复时展示（不写进脚本自身的更新页面/更新日志）。每次智能体修改脚本后（无论是否 bump）都必须运行：
   ```bash
   scripting-ts run "<skill_dir>/scripts/maintain_meta.ts" --queryparameters '{"action":"write-change-note","project":"<脚本目录名>","note":"<本次修改说明内容>"}'
   ```
   说明内容用中文简要列出本次改了什么（与对话里向用户汇报的修改内容一致），例如「新增设置项 + 版本 1.2.3 → 1.2.4」；纯微调（不 bump）也照写本次改了什么。

   4c. **智能体修改标记（mark-agent-modified）——所有被智能体修改的脚本**：脚本管理工具开了「自动备份更新」时，扫描只认“用户手动改的脚本”（含智能体改的）。为了让智能体刚改完版本号的脚本被识别为手动修改并触发自动备份，每次智能体修改脚本后都必须运行：
   ```bash
   scripting-ts run "<skill_dir>/scripts/maintain_meta.ts" --queryparameters '{"action":"mark-agent-modified","configPath":"<脚本管理工具配置绝对路径>","project":"<脚本目录名>"}'
   ```
   脚本会把 `agentModifiedAt[folderName] = Date.now()` 写入配置（有效窗口 5 分钟）。扫描时该脚本按“手动修改”处理：只备份它，忽略同批自动更新。`configPath` 为脚本管理工具配置文件绝对路径，即 `FileManager.appGroupDocumentsDirectory + "/script-manager-config.json"`（当前设备：`/private/var/mobile/Containers/Shared/AppGroup/BBC6651A-F46D-4AAB-A00B-48AAD01FB3D4/Documents/script-manager-config.json`）。

5. **修改说明只写 .change_notes，不填脚本自身的更新页面/更新日志**：第 1～4 步全部完成、最终版本号验证通过后，维护流程即告结束。维护流程对 `script.json` 只改 `author` / `version` / `remoteResource.url`（仅去掉 `?t=` 时间戳参数）；本次修改说明以第 4b 步的 `.change_notes` 形式写入脚本目录（随自动备份打包、恢复时展示，不落回本地）；**不要**把本次修改说明自动填进脚本自身的更新页面/更新日志等任何数据或文件（例如脚本内的更新说明页数据、CHANGELOG、README、注释等），也不得新增/追加这类说明内容——脚本自身更新日志仍由用户手动填写。除非用户明确要求。操作结束后，**在对话中向用户简要说明本次修改了什么（如版本号变化、远程链接清理、已写入修改说明）是可以的**。

`project` 参数可以是脚本目录名（相对 scripts/），也可以是绝对路径。

## 3. 版本号决策树（每次修改后按顺序判断）

版本号由**三组数字**构成：`主版本.次版本.修订号`（`major.minor.patch`，如 `1.2.3`）。

- **第三组（patch）**：**默认首选**。小改动一律升这里；大改动也优先考虑这里。
- **第二组（minor）**：大改动且你觉得确实合适时才升。
- **第一组（major）**：**尽可能别改动**，只有彻底重构、推倒重来等极端情况才动。

从第一个条件开始判断，命中即停：

### ① 微调？→ 不 bump

只改了这些（纯机械、不改变用户可见行为），版本号保持不动：

- 仅代码格式化（缩进、换行、重排、空格、命名风格统一）
- 纯视觉微调（颜色、间距、字号、图标、布局细节，不增减/重命名控件、不改文字）
- 等价重命名（变量/函数改名，行为完全一致）
- 仅日志输出调整
- 临时调试代码的增删
- 只改 `script.json` 的非 version 元数据（description、localizedNames、icon、color 等）

### ② 小改动？→ 第三组（patch）（默认首选）

| 修改类型 | 级别 | 示例 |
|----------|------|------|
| 参数调整、注释修改、按钮重命名、增加小按钮、小改进 | `patch`（1.0.0 → 1.0.1） | 改参数/设置项默认值、加注释、改按钮文字、加个小按钮 |
| Bug 修复、小修小补、边界处理 | `patch`（1.0.0 → 1.0.1） | 修复解析错误、崩溃、数据不对 |

### ③ 大改动？→ 优先第三组（patch），合适才升第二组（minor）

| 修改类型 | 级别 | 示例 |
|----------|------|------|
| 大功能新增、整个页面新生成的功能、多个小功能同时增加 | 默认 `patch`；改动确实重大、值得单独记录时才 `minor`（1.0.0 → 1.1.0） | 新增整个功能页面、一次性加多个功能 |

大改动**先考虑第三组（patch）**；只有当你觉得这次改动确实够分量、升到第二组（minor）更合适时，才升第二组。

### ④ 破坏性 / 架构级？→ 第一组（major）尽可能别动

| 修改类型 | 级别 | 示例 |
|----------|------|------|
| 破坏性变更、架构级重构、入口不兼容 | 优先 `minor`；只有推倒重来、彻底重构的极端情况才 `major`（1.0.0 → 2.0.0），**尽可能不要用** | 重写核心逻辑、接口不兼容 |

**第一组数字尽可能别改动**：只有真正推倒重来、彻底重构的极端情况才升 major；常规迭代一律不动第一组。

**拿不准时**：

- 拿不准「是否要 bump」→ 至少 bump patch，不要漏 bump。
- 拿不准「升到哪一级」→ 默认第三组（patch），不要动不动就动第二组，更不要动第一组。
- 一次修改里既有微调又有实质改动，按实质改动的级别 bump（默认 patch）。

## 4. 注意事项

- **不主动参考本地已存在的脚本**：除非用户特别交代，否则不要主动参考 scripts/ 目录下已存在的其他脚本（被修改脚本之外的本地脚本项目）来决定怎么写/怎么改；用户明确要求时才参考。
- **不自动终止**：修改脚本后必须一路跑到最终版本号更新完成为止；在完成作者补全、版本级判定、最终版本号写入并验证之前，不得中断流程、不得只汇报中间状态。
- **用中文给中间进度回复**：跑维护流程（作者补全、远程链接清理、版本级判定、版本号更新、最终验证）的每一步，都实时用中文在对话里向用户简要说明你做了什么（如「作者已补全」「远程资源链接已去掉 ?t= 时间戳」「版本 1.0.0 → 1.0.1」「已验证最终版本号」），不要等全部结束才一次性汇报。维护流程本身必须一口气跑完，只是汇报要分步实时进行。
- **自动清理远程资源链接时间戳**：维护脚本时，若 `script.json` 的 `remoteResource.url`（Scripting 应用里长按脚本设置的「远程资源链接」）带 `?t=<时间戳>` 参数（如 `https://raw.githubusercontent.com/.../xx.scripting?t=1787666102311`），自动去掉该参数，替换成干净链接（`https://raw.githubusercontent.com/.../xx.scripting`）。`check-author` / `bump` 时自动执行，也可单独运行 `clean-update-url` action 处理；仅清理时间戳属于微调，**不 bump 版本号**。
- **修改说明写入 .change_notes，不填脚本自身更新页面**：每次修改后把本次修改说明以 `.change_notes` 文件形式写入被改脚本目录（第 4b 步），供脚本管理工具自动备份随包带走、恢复时展示；即使 bump 了版本号，也不得把本次修改说明填入脚本自身的更新页面/更新日志等数据或文件（脚本内说明内容不新增、不追加、不修改——脚本自身更新日志由用户手动填写），除非用户明确要求；操作结束后可在对话中告知用户修改了什么。
- **所有被智能体修改的脚本都要打修改标记**：mark-agent-modified 与 write-change-note 适用于所有被智能体修改的脚本（不限于脚本管理工具）；每次修改后都运行，保证自动备份把该脚本识别为“手动修改”并带上修改说明。
- **已有其他作者的脚本不动 author**：当 `script.json` 的 `author.name` 存在且 ≠ WWWeng🐝，check-author 不改动 `author` 的任何内容（name/email/homepage 一律保留），不胡乱覆盖原作者信息。
- 只 bump 被修改的脚本，不要动其它脚本的版本号。
- 脚本会自动处理 semver 的 pre-release/build 后缀（bump 时重置）。
- 如果用户明确说「别改版本号」，尊重用户，不 bump。

## 5. 查找脚本历史版本（优先 ScriptBackups）

当需要**查找/搜索脚本的历史版本**（例如用户想看旧版本内容、找回被覆盖的代码、对比新旧差异、按旧版设计恢复等）时，**优先**去以下路径查找历史版本：

- **我的 iPhone › Scripting › ScriptBackups**（iOS 文件 App 路径；文件系统里即 Scripting 应用本机存储 Documents 目录下的 `ScriptBackups` 文件夹）

按脚本目录名在 `ScriptBackups` 下定位对应备份，结合文件名/时间挑出所需的历史版本；**只有**该路径下找不到所需历史版本时，才考虑其他来源（iCloud、GitHub 等）。找到历史版本后需要恢复/参考时，把对应备份内容复制回 scripts/ 下的脚本项目再继续处理（恢复后按本 skill 流程核对维护 version/author）。

# Available Tools

## run_shell_command
执行 `scripting-ts run "<skill_dir>/scripts/maintain_meta.ts" ...` 完成作者补全与版本 bump。`skill_dir` 即本 skill 目录。脚本返回 JSON，包含 `changed` / `oldVersion` / `newVersion` 等结果。

## file_tool
也可以直接用 file_tool 编辑 `script.json` 的 `author` / `version`，规则同上；但推荐用脚本，可避免手误。

# Script: maintain_meta.ts 参数说明

| 参数 | 说明 |
|------|------|
| `action` | `check-author`（默认）、`bump`、`mark-agent-modified`、`write-change-note` 或 `clean-update-url` |
| `project` | 脚本目录名或绝对路径，必填 |
| `level` | `patch` / `minor` / `major`，仅 bump 时用，默认 `patch` |
| `note` | 修改说明内容（中文，简要列出本次改了什么），仅 write-change-note 时用，必填 |
| `configPath` | 脚本管理工具配置绝对路径（`.../Documents/script-manager-config.json`），仅 mark-agent-modified 时用 |
| `dryRun` | `true` 时只计算不写入（调试用） |

- `check-author` / `bump` / `clean-update-url` 都会**顺带清理远程资源链接**：把 `remoteResource.url` 里形如 `?t=<时间戳>` 的防缓存参数去掉（如 `https://.../xx.scripting?t=1787666102311` → `https://.../xx.scripting`）。返回字段 `updateUrlBefore` / `updateUrlAfter` / `updateUrlCleaned`。
- `mark-agent-modified` 把 `agentModifiedAt[folderName] = Date.now()` 写入脚本管理工具配置（有效窗口 5 分钟），自动备份扫描时把该脚本按“手动修改”处理。
- `write-change-note` 把修改说明写入脚本目录的 `.change_notes` 文件（随备份打包、恢复时展示，不落回本地）。
- `clean-update-url` 只做清理，不改 author / version。

作者信息配置在 `config.json`：改作者名/邮箱/主页只需修改该文件的 `author` 对应字段（`name` / `email` / `homepage`）。check-author 会把缺失或属于本人的 author 补全为 config 中的完整信息；已有其他作者的脚本不修改 author。