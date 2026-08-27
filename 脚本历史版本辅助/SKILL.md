---
name: history-reference
description: 从 ScriptBackups 历史备份中查找、提取并恢复旧版脚本功能。当用户提到参考某个脚本的历史版本/旧版备份来改动、恢复或移植功能（如「参考🐝浏览器_1.0.1版本的xx功能」）时使用。
runtime: python
entry: scripts/backup_tool.py
metadata:
  display_name: "脚本历史版本辅助"
  author: "WWWeng🐝"
  repository: "https://github.com/vvvvvveng/Scripting-skills"
  last_updated: "2026-08-28 01:57:49"
  intent_patterns: "参考历史版本, 参考旧版, 从备份恢复, 找回功能, 恢复到旧版, ScriptBackups, 备份文件, 版本号, 参考xxx_1.0.1, 参考1.0.1版本"
  required_tools: "run_shell_command, file_tool"
---

# Purpose

当用户希望**从历史版本备份中查找、参考、恢复或移植某项功能**时使用本 skill。历史备份由「脚本管理工具」生成，存放在 ScriptBackups 目录。

典型场景：
- 用户觉得某个功能在旧版更好用，想找回旧版实现
- 用户想参考某脚本某历史版本的某个界面/功能，改到当前脚本
- 用户想对比当前脚本与旧版本某功能的差异
- 本地找不到对应脚本备份时，询问用户是否从 GitHub 获取（需用户同意）

# 作者与仓库

- **作者**：WWWeng🐝
- **仓库**：https://github.com/vvvvvveng/Scripting-skills

本 skill 通过 GitHub 仓库发布和更新。如果本地找不到对应备份且用户同意，可从该仓库获取。

# 核心概念

## 备份目录（唯一优先来源）

用户视角路径：`我的iPhone ▸ Scripting ▸ ScriptBackups`
实际文件系统路径（iPhone 本地沙盒，**随设备/用户自动适配**）：

```
/private/var/mobile/Containers/Data/Application/<设备UUID>/Documents/ScriptBackups/
```

> ℹ️ **自动适配机制**：`backup_tool.py` 启动时会从环境变量 `TMPDIR` 自动推导当前设备的沙盒路径（`TMPDIR` = `<沙盒>/tmp/`，去掉 `/tmp` 后拼 `Documents/ScriptBackups`）。不同设备/用户的沙盒 UUID 不同，但都能自动找到各自的备份目录，**无需手改路径**。
> 若 `TMPDIR` 不可用（如手动在电脑上跑脚本），工具会继续扫描 `~/Library/Mobile Documents/iCloud~*~Scripting/` 容器，自动找到 `destination: "icloud"` 时的历史位置；探测不到时把候选路径打印出来供排查。
> 当前用户配置是 `destination: "iphone"`，备份在沙盒路径。

查找历史版本时**优先**看这个目录，不要自行去别处找。

## 备份文件命名规则

- **单脚本备份**：`脚本名_版本号.scripting`，例如 `🐝浏览器_1.0.1.scripting`、`脚本管理工具_5.0.19.scripting`
- 备份文件是**标准 zip 包**，内部结构为 `脚本名/index.tsx`、`脚本名/script.json` 等完整项目文件
- `script.json` 内有 `version` 字段，可核对版本号

## ⚠️ 只读 .scripting，不读 zip 打包备份

**绝不从 `全部_日期_时间.zip` 这类打包 zip 里读取脚本**，即使它包含目标脚本。打包 zip 只用于整体备份/恢复，不适合作为参考来源；统一以 `.scripting` 单脚本备份为准。工具脚本会直接拒绝 zip 路径。

## 当前脚本位置

正在编辑的脚本在（Scripting 的 iCloud 脚本目录，路径随用户不同）：

```
<iCloud Documents>/scripts/脚本名/
```

备份 zip 内 `脚本名/` 下的文件与当前 `scripts/脚本名/` 下的文件一一对应，可逐文件对比。

# 首次使用初始化（每个新环境/用户只做一次）

首次在当前环境使用本 skill 时，把必要信息写入**全局记忆**（用 file_tool 操作，路径见 request_context 的 memory_global）。写全局而非工作区，是为了任何 workspace 都能直接识别备份位置，无需每个工作区重复初始化：

1. 检查 `memory_global` 的 `MEMORY.md` 是否已有 ScriptBackups 相关条目（如 `scriptbackups-location`）；已有则直接用，不重复写
2. 没有则创建全局记忆文件 `memories/scriptbackups-location.md`，内容包含：
   - ScriptBackups 备份目录的**实际绝对路径**（上面「备份目录」一节；含 TMPDIR 推导方式，UUID 随设备变化）
   - 命名规则：`脚本名_版本号.scripting`；只读 `.scripting`，不读 `全部_*.zip`
   - 访问方式：用本 skill 的 `backup_tool.py`，不要手动 find iCloud
   - 当前环境脚本目录 `scripts/` 的路径
3. 在全局 `MEMORY.md` 索引里加一行指针
4. 顺手确认备份目录里有哪些可用备份（跑一次 `list`），把「该用户环境里实际存在哪些脚本的备份」记入同一记忆文件，方便后续直接回答「有没有 1.0.1 的备份」
5. 若某工作区需要工作区级记忆（如该 workspace 特别关注某脚本的历史），也可在工作区记忆写简版并指向全局，避免重复维护

这样别的用户/环境首次使用时也能自动完成全局配置。已配置过就直接用，不重复写。

# 同步基线（skill 更新检测）

上述全局记忆文件 `scriptbackups-location.md` 末尾带一个「同步基线」小节，只关联**本 skill**（与其它 skill 无关）。每次会话开始时，对比本 skill 的 `SKILL.md` 修改时间与记忆里记录的基线时间：

- 当前修改时间与基线不一致 → 说明本 skill 已自动更新（`remoteResource` 拉新）→ 读最新 `SKILL.md`，按新内容重写全局记忆（新增就新增、调整就改动、删除就删除）
- 重写后把新时间戳更新为基线

本 skill 的首次使用初始化也须把这一「同步基线」机制写入 `scriptbackups-location.md`，保证更新后可检测。

# 工具脚本

`scripts/backup_tool.py` 提供只读访问备份的能力，用 `run_shell_command` 调用（python3）：

```bash
python3 "<skill_dir>/scripts/backup_tool.py" list
python3 "<skill_dir>/scripts/backup_tool.py" list --script 🐝浏览器
python3 "<skill_dir>/scripts/backup_tool.py" find 🐝浏览器
python3 "<skill_dir>/scripts/backup_tool.py" find 🐝浏览器 1.0.1
python3 "<skill_dir>/scripts/backup_tool.py" fetch 🐝浏览器
python3 "<skill_dir>/scripts/backup_tool.py" fetch 🐝浏览器 --repo 其他用户/仓库
python3 "<skill_dir>/scripts/backup_tool.py" info "<备份文件路径>"
python3 "<skill_dir>/scripts/backup_tool.py" files "<备份文件路径>"
python3 "<skill_dir>/scripts/backup_tool.py" search "<备份文件路径>" "关键词" --context 2 --file index.tsx
python3 "<skill_dir>/scripts/backup_tool.py" extract "<备份文件路径>" --file index.tsx
python3 "<skill_dir>/scripts/backup_tool.py" extract "<备份文件路径>" --file index.tsx --range 100:200
```

命令说明：

| 命令 | 作用 |
|---|---|
| `list [--script 名]` | 列出备份目录中的 `.scripting` 备份（忽略 zip），可按脚本名过滤 |
| `find <脚本名> [版本号]` | 按脚本名（+可选版本前缀，如 `5.0` 可匹配 `5.0.19`）查找 `.scripting` 备份 |
| `fetch <脚本名> [--repo 仓库]` | 从 GitHub 仓库下载 `.scripting` 到临时目录（默认仓库 `vvvvvveng/Scripting-releases`；下载的是仓库当前版本，非历史版本） |
| `info <路径>` | 显示备份内 `script.json` 摘要（脚本名/版本/入口/描述） |
| `files <路径> [--dir 子目录]` | 列出备份 zip 内全部文件及大小 |
| `search <路径> <关键词> [--context N] [--file 文件名] [--regex]` | 在 zip 内所有文本文件中搜索关键词，输出`文件:行号`和上下文；`--file` 限定文件（自动匹配 basename） |
| `extract <路径> --file 内部路径 [--range 开始:结束]` | 打印 zip 内文本文件内容（带行号），可用 `--range` 只看某段 |

注意：
- 本环境**不支持 shell 管道/重定向**（`|`、`>`、`2>&1`），命令要写完整、直接执行
- `search` 定位大文件（如几百 KB 的 index.tsx）里的代码最有效；定位后用 `extract --range` 取完整片段
- 所有命令只读，**绝不修改备份文件**；zip 打包备份会被拒绝

# GitHub 兜底（仅当本地找不到且用户同意时）

正常情况下历史版本以本地 ScriptBackups 的 `.scripting` 为准。**GitHub 不是默认来源，agent 不主动去下载**。

只有当「本地 ScriptBackups 里找不到用户要的脚本/版本」时，才向用户说明情况，并**询问用户**是否需要从 GitHub 获取（例如「本地没有🐝浏览器的备份，需要我从你的 GitHub 发布仓库获取吗？」）。用户明确同意/要求后才执行：

1. 用 `fetch <脚本名>` 从发布仓库下载（默认 `vvvvvveng/Scripting-releases`，即用户作者的发布仓库；用户给了其他仓库就用 `--repo`）
2. 下载的文件保存在 workspace 临时目录，返回路径后照常用 `info` / `search` / `extract` 读取
3. 注意：发布仓库 main 分支只保存**当前最新版**（文件名不带版本号，如 `脚本管理工具.scripting`），不是历史版本；历史版本仍以本地 ScriptBackups 为准
4. 读取完如需清理，删除临时目录里的下载文件
5. 若用户不同意从 GitHub 获取，就停在本地查找结果上，由用户决定下一步

# 工作流程

## 第 1 步：解析需求（脚本名 + 版本号 + 功能描述）

从用户话里提取三要素，判断场景：

**场景 A：同脚本参考**（参考的是当前正在编辑/讨论的脚本自己）
- 「我希望参考🐝浏览器_1.0.1版本的xx功能帮我改动一下」→ 脚本=🐝浏览器，版本=1.0.1，功能=xx
- 「你帮我参考1.0.1版本做一下什么地方的什么功能」→ 用户只给了版本号，**当前脚本**按对话上下文判断（如正在编辑 🐝浏览器，则脚本=🐝浏览器）

**场景 B：跨脚本参考**（参考别的脚本的功能做进当前脚本）
- 「你帮我参考一下🐝密码管理器的什么界面的什么功能帮我做一下什么功能」
- **必须确认「参考哪个脚本」和「版本号」两个信息**。用户漏了版本号时，先查找该脚本有哪些历史备份再向用户确认用哪个版本；若该脚本只有一个备份，可用但要在回复里说明用的是哪个版本

解析时注意：
- 脚本名通常含 emoji 或特殊字符（🐝浏览器、IPA-Tool(自修改版)），按用户原话提取即可，匹配时用包含关系
- 版本号形如 `1.0.1`、`5.0.19`，可能带「版本」字样
- 功能描述关键词用于后续 `search` 定位代码

## 第 2 步：查找备份

```bash
python3 "<skill_dir>/scripts/backup_tool.py" find <脚本名> [版本号]
```

- 只查 `.scripting` 单脚本备份；**不读 `全部_*.zip` 打包备份**
- 若 `find` 未命中：用 `list` 看备份目录里实际有什么，可能有相近命名（如 `(自修改版)` 后缀）
- 仍找不到时：**如实告知用户本地备份里没有**，并询问是否需要从 GitHub 获取（见「GitHub 兜底」一节）；用户同意后才用 `fetch`，**不要主动下载**

## 第 3 步：确认备份版本

```bash
python3 "<skill_dir>/scripts/backup_tool.py" info "<备份文件路径>"
```

核对 `script.json` 里的版本号与用户要求一致，避免拿错版本。

## 第 4 步：定位功能代码

1. 用用户描述的功能关键词在备份内 `search`，例如功能是「导出记录」：
   ```bash
   python3 "<skill_dir>/scripts/backup_tool.py" search "<备份路径>" "导出" --context 3 --file index.tsx
   ```
2. 命中后判断是否就是要找的功能；关键词太泛时加 `--file` 缩小范围，或换更精准的词
3. 用 `extract --range` 取该功能的完整代码片段（含周边函数/组件定义）
4. 若备份里有多个文件（如 `manager.ts`、`lang.ts`），先 `files` 看结构，再按需搜索对应文件

## 第 5 步：对比当前脚本

- 用 `file_tool` 读当前 `scripts/<脚本名>/` 下对应文件
- 对比备份代码与当前代码，确认：
  - 该功能在当前版本是否已被删除/改动
  - 备份中的实现依赖哪些周边代码（工具函数、常量、语言包等），一并移植
  - 当前脚本的其他部分是否与备份有冲突（比如命名、依赖版本）

## 第 6 步：移植/恢复功能

- 将备份中的功能实现应用到当前脚本文件，保持当前脚本其余部分不变
- 跨脚本移植时：把功能代码、依赖的工具函数、语言包条目、权限声明等都搬过来，并适配当前脚本的命名/风格
- 涉及 UI 时遵守当前项目的设计风格（iOS 26 风格 + iOS 18 兼容）
- 改动后用 `get_typescript_diagnostics` 检查语法/类型错误
- 功能恢复完成后，按 **script-runtime-maintainer** skill 的流程更新 `script.json`（作者信息、版本号）

## 第 7 步：向用户汇报

用中文说明：
- 参考的是哪个备份文件（脚本名 + 版本号 + 路径；若是 GitHub 下载的注明来源）
- 找到了什么功能、代码在哪（文件 + 大致位置）
- 做了哪些改动（不要自动填写更新日志，口头总结即可）
- 若备份中没有用户要的功能/版本，如实说明并给出替代建议

# 注意事项

- **只读备份**：backup_tool.py 不修改备份文件；需要把备份代码写进当前脚本时用 file_tool 编辑 `scripts/` 下的文件，绝不写回 `.scripting`
- **不读 zip 打包备份**：绝不从 `全部_*.zip` 读取脚本，即使里面包含目标脚本；只以 `.scripting` 为准
- **跨脚本必须确认脚本名+版本号**：用户没说全时先查 `find` 结果再问用户，不要擅自选版本
- **用户没要求时不要用本 skill**：不要主动去翻 ScriptBackups 参考/对比其他脚本
- **大文件分段看**：index.tsx 等可能几十万字节，`search` 定位、`extract --range` 分段看，不要一次性全量打印
- **找不到备份**：明确告知用户备份目录里可用的 `.scripting` 备份清单；若本地确实没有，**询问**用户是否要从 GitHub 获取（agent 不主动下载），用户不同意就停在本地结果上
- **首次使用记得初始化记忆**：见「首次使用初始化」一节，把路径和可用备份写入工作区记忆，并同步写一条全局记忆提示（只写触发提示、不含路径/UUID）
