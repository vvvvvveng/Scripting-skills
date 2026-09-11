---
name: 数据读取辅助
description: 从🐝密码管理器的存储文件统一读取凭据（账号/密码/Token/API Key）。当需要任何账号、密码、Token、API Key 等凭据信息时优先使用本 skill，从存储读取而不是问用户要
runtime: scripting
entry: scripts/main.ts
metadata:
  display_name: "数据读取辅助"
  last_updated: "2026-09-12 01:32:00"
  intent_patterns: "获取账号、获取密码、获取 token、读取凭据、bee-credentials、账号密码、api key、github token、telegram token、deepseek token、需要密码、需要 token、凭据、项目码、按项目码读取"
  required_tools: "run_shell_command, file_tool"
---

# Purpose

当需要获取账号、密码、Token、API Key 等凭据信息时，使用本 skill 从「🐝密码管理器」的存储文件 `credentials.json` 中统一读取，而不是问用户要。

# 存储路径

```typescript
const credentialsPath =
  FileManager.appGroupDocumentsDirectory + "/🐝密码管理器/credentials.json"
```

⚠️ **重要：App Group 的 UUID 每个用户/设备不同**，绝对路径不要硬编码，统一用 `FileManager.appGroupDocumentsDirectory` 动态拼接。

# 文件结构

```json
{
  "updatedAt": "2026-08-24T...",
  "viewMode": "grouped",
  "showGuide": true,
  "autoBackupEnabled": false,
  "autoBackupAt": "2026-08-25T...",
  "services": {
    "github": [
      {
        "id": "acc_xxx",
        "code": "12345",
        "fields": [
          { "key": "account",  "title": "账号",   "value": "用户名" },
          { "key": "password", "title": "密码",   "value": "xxx", "secure": true },
          { "key": "userId",   "title": "用户ID", "value": "123" },
          { "key": "token",    "title": "Token",  "value": "ghp_xxx", "secure": true },
          { "key": "custom",   "title": "备注",   "value": "xxx" }
        ]
      }
    ]
  },
  "security": { ... },
  "templates": [ ... ]
}
```

- 服务名建议用小写（如 `github`、`deepseek`、`telegram`）；查找时**大小写不敏感**，即使存储里是 `Github` 也能命中（注意 `data.services` 的 key 是添加时填写的原始服务名，可能带大写）
- 字段 key：`account`（账号）、`password`（密码）、`userId`（用户ID）、`token`（Token/API Key）、`custom`（备注）；注意「账号」和「用户名」在数据里 key 都是 `account`
- 一个服务下可以有多个账号
- `code`：**项目码**，5 位数字、**全库唯一**（首位不为 0，范围 10000–99999）。由🐝密码管理器在新建/复制/导入/恢复时自动生成，**生成后永不改变**；在账号详情页服务名尾部右对齐显示（点击可复制），首页搜索框也能直接搜到。**用于精确定位到某一个账号**
- 其余顶层字段（`viewMode`/`showGuide`/`autoBackup*`）是界面与自动备份配置，与本 skill 读取无关，忽略即可

# 定位优先级（重要）

调用本 skill 定位账号时，一律按以下优先级：

1. **优先用项目码**（参数 `projectCode`，5 位数字，全库唯一）——**能拿到项目码就一定用它**，这是唯一能精确定位到“某个具体账号”的方式。
2. **没有项目码时**，再考虑用 `service`（配合 `key`）等其它方式定位。
3. **两者都传且指向不同账号时，以项目码为准**：脚本会返回项目码命中的那个账号，并回传 `serviceConflict: true` 与 `note` 说明（不报错、不取错项）。

为什么：同一服务下可以有多个账号，只按服务名可能拿错账号；项目码是每个账号稳定且唯一的标识。

不确定项目码时：先按服务读取（不传 `key`），返回的每个账号都会带 `code` 字段，再用它精确调用。

# 调用步骤

## 1. 直接读取凭据

用 `run_shell_command` 执行脚本：

```
scripting-ts run <skill_dir>/scripts/main.ts --queryparameters '{"service":"github","key":"token"}'
```

参数说明：
| 参数 | 必填 | 说明 |
|------|------|------|
| `projectCode` | **优先** | 项目码，5 位数字（如 `12345`）。全库唯一，**优先用它定位账号**；传了它就是全局查找，不用再传 `service` |
| `service` | 否* | 服务名，小写，如 `github`、`deepseek`、`telegram`；*未传 `projectCode` 时必填 |
| `key` | 否 | 要获取的字段 key，如 `token`、`password`、`account`。不传则返回该账号/该服务所有账号的全部字段 |
| `confirm` | 否 | 是否确认读取敏感字段明文，布尔，默认 `false`。仅当 `key` 命中的字段是敏感字段（secure，如密码/Token/API Key）时需要；传 `true` 才返回明文，不传则返回打码值 |

推荐用法（有项目码就用项目码）：

```
# 按项目码精确读取某个账号的 Token（敏感字段需 confirm: true 才返回明文）
scripting-ts run <skill_dir>/scripts/main.ts --queryparameters '{"projectCode":"12345","key":"token","confirm":true}'

# 没有项目码时，按服务名读取
scripting-ts run <skill_dir>/scripts/main.ts --queryparameters '{"service":"github","key":"token"}'
```

返回结果：
- 找到凭据 → 返回 JSON 对象，包含账号列表或指定字段值（按项目码读取时含 `service`（实际所属服务）与 `code`；若同时传了冲突的 `service`，额外返回 `serviceConflict: true` 与 `note`）
- 敏感字段未确认（`key` 命中 secure 字段但没传 `confirm: true`）→ 返回 `requiresConfirm: true` 和打码值，提示需要显式确认
- 服务不存在 / 项目码查不到 → 返回提示信息（前者列出已有服务名）
- 参数不合法 → 返回错误（如项目码不是 5 位数字）
- 文件不存在 → 进入首次使用引导流程

## 2. 手动逐步骤读取（不执行脚本，纯 Agent 操作）

1. 用 `FileManager.existsSync(credentialsPath)` 判断文件是否存在
2. 不存在 → 走下面的「首次使用引导」
3. 存在 → `FileManager.readAsStringSync(credentialsPath)` 读 JSON
4. **有项目码**：遍历所有 `services` 下每个账号，找 `account.code` 等于目标项目码的那一个（全库唯一，命中的就是目标账号），跳过第 5 步
5. 没有项目码时：按 `services["服务名"]`（大小写不敏感）找账号列表
6. 遍历 `fields` 数组，按 `key` 匹配需要的字段

# 安全机制（敏感字段默认打码）

本 skill 对凭据明文做了分层保护：

1. **不指定 `key` 批量读取时**：secure 字段（密码/Token/API Key）一律返回 `*** (加密隐藏)`，只有 key/title；非敏感字段（账号、用户ID、备注）正常返回。额外生成的 `flatMap` 也**只包含非 secure 字段**。
2. **指定 `key` 读取时**：
   - 命中的是**非敏感字段**（如 `account`、`userId`、`custom`）→ 正常返回明文。
   - 命中的是**敏感字段**（如 `password`、`token`）且**未传 `confirm: true`** → 返回打码值 + `requiresConfirm: true`，不泄露明文。
   - 命中的是**敏感字段**且**显式传了 `confirm: true`** → 返回明文。

**使用原则**：
- 非敏感字段（账号/用户ID/备注）可以直接读，不需要 `confirm`。
- 敏感字段（密码/Token/API Key）**只有用户明确要求使用时**（如“用我的 GitHub token 调 API”）才带 `confirm: true` 读取；用户只是询问、核对、展示时一律只读打码值。
- 获取到敏感明文后，不要把它原样重复打印进对话或写入任何文件/记忆，仅在需要调用 API 时于命令行内直接使用。

# 首次使用引导

当 `credentials.json` 不存在时，说明用户还没在🐝密码管理器里保存过数据。此时：

1. **告知用户**：目前🐝密码管理器的存储文件不存在，暂时无法获取凭据
2. **引导用户**：打开 Scripting App → 找到「🐝密码管理器」脚本 → 运行并添加对应服务的账号（如 GitHub 的 Token）
3. **用户保存数据后**，`credentials.json` 会自动生成到上述路径
4. **Agent 将路径记录到全局记忆**：确认文件存在后，调用 `file_tool` 将路径格式写入 `memory/memories/credentials-from-bee-password-manager.md`（如果已存在则跳过）
5. **同步把凭据安全规范写入全局记忆**：检查全局 `memory/memories/credentials-safety.md` 是否存在，没有则创建，内容为上面「安全机制（敏感字段默认打码）」一节的**使用原则**（密码/Token/API Key 等私密信息使用时不得以明文形式出现在对话、文件或记忆中，仅在调用 API 的命令行内直接使用；只有用户明确要求时才能读明文），并在全局 `MEMORY.md` 加一行索引指针

> 首次使用初始化要写两份全局记忆：`credentials-from-bee-password-manager.md`（凭据读取路径）+ `credentials-safety.md`（凭据安全规范），缺一不可。

# 同步基线（skill 更新检测）

上述两份全局记忆文件末尾各带一个「同步基线」小节，只关联**本 skill**（与其它 skill 无关）。每次会话开始时，对比本 skill 的文件修改时间（`SKILL.md`、`scripts/main.ts`）与记忆里记录的基线时间：

- 当前修改时间与基线不一致 → 说明本 skill 已自动更新（`remoteResource` 拉新）→ 读最新 `SKILL.md`，按新内容重写对应全局记忆（新增就新增、调整就改动、删除就删除）
- 重写后把新时间戳更新为基线

本 skill 的 `SKILL.md` 首次使用引导也须把这一「同步基线」机制写入上述全局记忆，保证更新后可检测。

# 安装与更新

- 本 skill 从仓库 https://github.com/vvvvvveng/Scripting-skills 安装（`skill.json` 的 `remoteResource` 指向该仓库，Scripting 会按 `autoUpdateInterval` 自动检查更新）。
- 也可以打开「🐝密码管理器」脚本，首页使用说明「六、Scripting 快捷调用」里有「一键安装『数据读取辅助』skill」按钮，点击即可安装/检查最新版。

# 作者信息

- 作者：WWWeng🐝
- 仓库：https://github.com/vvvvvveng/Scripting-skills

# 加密备份

iCloud 目录下还有一个 `credentials.backup.enc` 加密备份（路径 `FileManager.iCloudDocumentsDirectory + "/credentials.backup.enc"`），这是带密码保护的加密文件，需要用户在🐝密码管理器里输入应用密码恢复。

🐝密码管理器现在支持两种备份：

1. **手动备份**：设置页「备份到 iCloud（加密）」，输入备份密码后加密保存。
2. **自动备份**：设置页开启「自动备份到 iCloud」后，每次打开🐝密码管理器都会自动用保存的备份密码加密备份（开关、密码、上次自动备份时间存在本地 `credentials.json` 的 `autoBackup*` 字段）。

两种备份的产物都是同一个 `credentials.backup.enc`，使用 AES-256-GCM 加密，Agent **无法直接解密**，不要尝试读取解密；需要恢复时引导用户在🐝密码管理器里操作。

# 注意事项

- 永远不要硬编码 App Group 的 UUID 路径到脚本或文档中
- 编辑脚本时不要修改 🐝密码管理器 的存储路径或数据结构
- 定位账号时**优先用项目码 `projectCode`**；没有项目码再用 `service`/`key`；两者冲突时以项目码为准
- 如果用户说"凭据不对"，检查文件是否存在、项目码是否敲对（5 位数字）、服务名是否匹配、字段 key 是否对应