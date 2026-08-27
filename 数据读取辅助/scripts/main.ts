import { Script } from "scripting"

// FileManager 为全局对象，无需 import

// ---------- 类型定义 ----------

interface FieldValue {
  key?: string
  title: string
  value: string
  secure?: boolean
}

interface Account {
  id: string
  fields: FieldValue[]
}

interface CredentialsFile {
  updatedAt?: string
  services: Record<string, Account[]>
  security?: unknown
  templates?: unknown
  viewMode?: "grouped" | "independent"
  showGuide?: boolean
  autoBackupEnabled?: boolean
  autoBackupPassword?: string
  autoBackupAt?: string
}

// ---------- 主逻辑 ----------

function main() {
  const params = Script.queryParameters ?? {}

  // 必填：服务名（小写）
  const service = (params.service ?? "").toString().trim().toLowerCase()
  if (!service) {
    Script.exit({
      success: false,
      error: "缺少必填参数 service（服务名，如 github、deepseek、telegram）",
    })
    return
  }

  // 可选：要获取的字段 key（如 token、password、account）
  const key = (params.key ?? "").toString().trim().toLowerCase() || undefined

  // 可选：是否确认读取敏感字段（secure 字段）的明文。默认 false —— 敏感字段只返回打码值。
  const confirmSensitive =
    params.confirm === true ||
    String(params.confirm).toLowerCase() === "true" ||
    String(params.confirm) === "1"

  // 构建存储路径（App Group 专属目录，持久，不会被 Agent 会话机制清理）
  const credentialsPath =
    FileManager.appGroupDocumentsDirectory + "/🐝密码管理器/credentials.json"

  // 检查文件是否存在
  if (!FileManager.existsSync(credentialsPath)) {
    Script.exit({
      success: false,
      error: "🐝密码管理器的存储文件不存在",
      hint: "请先在 Scripting App 中运行「🐝密码管理器」脚本，添加对应服务的账号后重试。",
      credentialsPath: credentialsPath,
    })
    return
  }

  // 读取文件
  let raw: string
  try {
    raw = FileManager.readAsStringSync(credentialsPath)
  } catch (e) {
    Script.exit({
      success: false,
      error: "读取凭据文件失败",
      detail: String(e),
    })
    return
  }

  // 解析 JSON
  let data: CredentialsFile
  try {
    data = JSON.parse(raw)
  } catch (e) {
    Script.exit({
      success: false,
      error: "凭据文件格式错误（不是有效的 JSON）",
      detail: String(e),
    })
    return
  }

  // 检查 services 是否存在
  if (!data.services || typeof data.services !== "object") {
    Script.exit({
      success: false,
      error: "凭据文件结构异常：缺少 services 字段",
    })
    return
  }

  // 查找服务（大小写不敏感：存储里服务名可能含大写，如 Github/Cloudflare/Gmail）
  const serviceKey = Object.keys(data.services).find(k => k.toLowerCase() === service)
  const accounts = serviceKey ? data.services[serviceKey] : undefined
  if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
    const availableServices = Object.keys(data.services)
    Script.exit({
      success: false,
      found: false,
      error: `服务「${service}」没有找到凭据`,
      hint: availableServices.length > 0
        ? `目前已保存的服务：${availableServices.join("、")}`
        : "还未保存任何服务凭据，请先在🐝密码管理器中添加。",
      availableServices: availableServices,
    })
    return
  }

  // 如果指定了 key，返回第一个匹配的值
  if (key) {
    // 遍历所有账号，找第一个匹配 key 的字段值
    for (const account of accounts) {
      for (const field of account.fields) {
        if (field.key && field.key.toLowerCase() === key && field.value) {
          // 敏感字段（secure）默认打码：只有显式传 confirm: true 才返回明文
          if (field.secure && !confirmSensitive) {
            Script.exit({
              success: true,
              service: service,
              key: key,
              found: false,
              requiresConfirm: true,
              value: "*** (敏感字段已隐藏)",
              accountId: account.id,
              hint: `字段「${key}」是敏感字段（secure），默认不返回明文。如确需读取，请重新调用并显式传入 confirm: true。`,
            })
            return
          }
          Script.exit({
            success: true,
            service: service,
            key: key,
            value: field.value,
            accountId: account.id,
          })
          return
        }
      }
    }

    // 没找到匹配的字段 key
    Script.exit({
      success: false,
      found: false,
      error: `服务「${service}」的账号中未找到字段 key 为「${key}」的值`,
      hint: `可用字段 key：${extractKeys(accounts).join("、")}（从实际数据中提取）`,
    })
    return
  }

  // 未指定 key：返回该服务所有账号的全部字段（secure 字段只返回 key 和 title，不返回 value）
  const result = accounts.map(account => ({
    id: account.id,
    fields: account.fields.map(f => ({
      key: f.key,
      title: f.title,
      value: f.secure ? "*** (加密隐藏)" : f.value,
      secure: !!f.secure,
    })),
  }))

  // 同时也返回一个可直接使用的键值映射（只包含非 secure 字段）
  const flatMap: Record<string, string> = {}
  // 取第一个账号的字段做平铺
  if (result.length > 0) {
    for (const f of accounts[0].fields) {
      if (f.key && !f.secure && f.value) {
        flatMap[f.key] = f.value
      }
    }
  }

  Script.exit({
    success: true,
    service: service,
    accounts: result,
    accountCount: accounts.length,
    flatMap: Object.keys(flatMap).length > 0 ? flatMap : undefined,
  })
}

function extractKeys(accounts: Account[]): string[] {
  const keys = new Set<string>()
  for (const a of accounts) {
    for (const f of a.fields) {
      if (f.key) keys.add(f.key)
    }
  }
  return Array.from(keys)
}

main()