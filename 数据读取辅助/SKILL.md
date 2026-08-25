---
name: 数据读取辅助
description: 从🐝密码管理器的存储文件统一读取凭据（账号/密码/Token/API Key）。当需要任何账号、密码、Token、API Key 等凭据信息时优先使用本 skill，从存储读取而不是问用户要
runtime: scripting
entry: scripts/main.ts
metadata:
  display_name: "数据读取辅助"
  intent_patterns: "获取账号、获取密码、获取 token、读取凭据、bee-credentials、账号密码、api key、github token、telegram token、deepseek token、需要密码、需要 token、凭据"
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
  "services": {
    "github": [
      {
        "id": "acc_xxx",
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

- 服务名用小写（如 `github`、`deepseek`、`telegram`）
- 字段 key：`account`（账号）、`password`（密码）、`userId`（用户ID）、`token`（Token/API Key）、`custom`（备注）
- 一个服务下可以有多个账号

# 调用步骤

## 1. 直接读取凭据

用 `run_shell_command` 执行脚本：

```
scripting-ts run <skill_dir>/scripts/main.ts --queryparameters '{"service":"github","key":"token"}'
```

参数说明：
| 参数 | 必填 | 说明 |
|------|------|------|
| `service` | 是 | 服务名，小写，如 `github`、`deepseek`、`telegram` |
| `key` | 否 | 要获取的字段 key，如 `token`、`password`、`account`。不传则返回该服务所有账号的全部字段 |

返回结果：
- 找到凭据 → 返回 JSON 对象，包含账号列表或指定字段值
- 服务不存在 → 返回提示信息，列出已有服务名
- 文件不存在 → 进入首次使用引导流程

## 2. 手动逐步骤读取（不执行脚本，纯 Agent 操作）

1. 用 `FileManager.existsSync(credentialsPath)` 判断文件是否存在
2. 不存在 → 走下面的「首次使用引导」
3. 存在 → `FileManager.readAsStringSync(credentialsPath)` 读 JSON
4. 按 `services["服务名"]` 找账号列表
5. 遍历 `fields` 数组，按 `key` 匹配需要的字段

# 首次使用引导

当 `credentials.json` 不存在时，说明用户还没在🐝密码管理器里保存过数据。此时：

1. **告知用户**：目前🐝密码管理器的存储文件不存在，暂时无法获取凭据
2. **引导用户**：打开 Scripting App → 找到「🐝密码管理器」脚本 → 运行并添加对应服务的账号（如 GitHub 的 Token）
3. **用户保存数据后**，`credentials.json` 会自动生成到上述路径
4. **Agent 将路径记录到全局记忆**：确认文件存在后，调用 `file_tool` 将路径格式写入 `memory/memories/credentials-from-bee-password-manager.md`（如果已存在则跳过）

# 作者信息

- 作者：WWWeng🐝
- 仓库：https://github.com/vvvvvveng/Scripting-skills

# 加密备份

iCloud 目录下还有一个 `credentials.backup.enc` 加密备份，这是带密码保护的加密文件，需要用户在🐝密码管理器里输入应用密码恢复。Agent **无法直接解密**，不要尝试读取解密。

# 注意事项

- 永远不要硬编码 App Group 的 UUID 路径到脚本或文档中
- 编辑脚本时不要修改 🐝密码管理器 的存储路径或数据结构
- 如果用户说"凭据不对"，检查文件是否存在、服务名是否匹配、字段 key 是否对应