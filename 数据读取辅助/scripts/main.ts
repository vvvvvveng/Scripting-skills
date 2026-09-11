import { Script } from "scripting"

// 定位优先级（重要）：项目码(projectCode) > 服务名(service) / 其它定位方式。
// - 传了 projectCode 就按项目码全局定位（5 位数字、全库唯一）
// - 只有没传 projectCode 时才按 service(+key) 定位
// - 两者都传且指向不同账号时，以 projectCode 为准（返回该账号并回传 serviceConflict 提示）

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
  // 项目码：5 位数字、全库唯一，由「🐝密码管理器」在新建/复制/导入/恢复时自动生成，
  // 一经生成不再变更（账号详情页服务名尾部右对齐显示、点击可复制）
  code?: string
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

// 项目码格式：5 位数字（实际生成范围 10000–99999，首位不为 0）
function normalizeProjectCode(v: unknown): string | undefined {
  const s = String(v ?? "").trim()
  return /^[1-9]\d{4}$/.test(s) ? s : undefined
}

// ---------- 主逻辑 ----------

function main() {
  const params = Script.queryParameters ?? {}

  // 可选：服务名（小写）。传了 projectCode 时可以省略
  const service = (params.service ?? "").toString().trim().toLowerCase()

  // 可选：项目码（5 位数字）——全库唯一，用于精确锁定某一个账号
  const codeRaw = (params.projectCode ?? params.code ?? "").toString().trim()
  const code = codeRaw ? normalizeProjectCode(codeRaw) : undefined
  if (codeRaw && !code) {
    Script.exit({
      success: false,
      error: `项目码「${codeRaw}」格式不正确`,
      hint: "项目码是 5 位数字（如 12345），可在🐝密码管理器的账号详情页服务名尾部看到，点击即可复制。",
    })
    return
  }

  if (!service && !code) {
    Script.exit({
      success: false,
      error: "缺少参数：至少需要 service（服务名）或 projectCode（5 位项目码）之一",
      hint: "按服务读取：service=github；按项目码精确读取某个账号：projectCode=12345（项目码在账号详情页服务名尾部）。",
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

  const serviceKeys = Object.keys(data.services)

  // ---------- 1) 按项目码精确锁定账号（全库唯一，跨服务查找） ----------
  if (code) {
    const hits: { service: string; account: Account }[] = []
    for (const svcName of serviceKeys) {
      const list = data.services[svcName]
      if (!Array.isArray(list)) continue
      for (const account of list) {
        if (account.code === code) hits.push({ service: svcName, account })
      }
    }

    if (hits.length === 0) {
      Script.exit({
        success: false,
        found: false,
        error: `没有找到项目码为「${code}」的账号`,
        hint: "项目码在账号详情页服务名尾部显示（点击可复制），也可以在首页搜索框直接搜项目码。",
      })
      return
    }

    const hit = hits[0]

    // 定位优先级：项目码 > 服务名/其它定位方式。
    // 两者都传但指向不同账号时，一律以项目码为准（不报错），并回传提示。
    const serviceConflict = !!service && hit.service.toLowerCase() !== service
    const conflict = serviceConflict
      ? {
          serviceConflict: true,
          note: `传入的 service「${service}」与项目码「${code}」指向不同账号；已按优先级以项目码为准（该账号实际在服务「${hit.service}」下）。`,
        }
      : {}

    // 指定了 key：只在这一个账号里找字段
    if (key) {
      const field = hit.account.fields.find(
        f => f.key && f.key.toLowerCase() === key && f.value
      )
      if (!field) {
        Script.exit({
          success: false,
          found: false,
          error: `项目码「${code}」的账号中没有字段 key 为「${key}」的值`,
          hint: `该账号可用字段 key：${extractKeys([hit.account]).join("、")}`,
          service: hit.service,
          code: code,
          accountId: hit.account.id,
          ...conflict,
        })
        return
      }
      if (field.secure && !confirmSensitive) {
        Script.exit({
          success: true,
          service: hit.service,
          code: code,
          accountId: hit.account.id,
          key: key,
          found: false,
          requiresConfirm: true,
          value: "*** (敏感字段已隐藏)",
          hint: `字段「${key}」是敏感字段（secure），默认不返回明文。如确需读取，请重新调用并显式传入 confirm: true。`,
          ...conflict,
        })
        return
      }
      Script.exit({
        success: true,
        service: hit.service,
        code: code,
        accountId: hit.account.id,
        key: key,
        value: field.value,
        ...conflict,
      })
      return
    }

    // 未指定 key：返回这个账号的全部字段（secure 字段只返回 key/title）
    const accountResult = maskAccount(hit.account)

    if (hits.length > 1) {
      Script.exit({
        success: true,
        service: hit.service,
        code: code,
        accountCount: hits.length,
        accounts: hits.map(h => ({ service: h.service, ...maskAccount(h.account) })),
        warning: `项目码「${code}」命中 ${hits.length} 个账号（正常不应重复），已返回全部命中项。`,
        ...conflict,
      })
      return
    }

    Script.exit({
      success: true,
      service: hit.service,
      code: code,
      accountCount: 1,
      account: accountResult,
      flatMap: flatMapOf(hit.account),
      ...conflict,
    })
    return
  }

  // ---------- 2) 按服务名读取（原有行为） ----------
  // 查找服务（大小写不敏感：存储里服务名可能含大写，如 Github/Cloudflare/Gmail）
  const serviceKey = serviceKeys.find(k => k.toLowerCase() === service)
  const accounts = serviceKey ? data.services[serviceKey] : undefined
  if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
    Script.exit({
      success: false,
      found: false,
      error: `服务「${service}」没有找到凭据`,
      hint: serviceKeys.length > 0
        ? `目前已保存的服务：${serviceKeys.join("、")}`
        : "还未保存任何服务凭据，请先在🐝密码管理器中添加。",
      availableServices: serviceKeys,
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
              code: account.code,
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
            code: account.code,
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
  const result = accounts.map(a => maskAccount(a))

  // 同时也返回一个可直接使用的键值映射（只包含非 secure 字段）
  const flatMap = flatMapOf(accounts[0]) ?? {}

  Script.exit({
    success: true,
    service: service,
    accounts: result,
    accountCount: accounts.length,
    // 每个账号的项目码，便于后续用 projectCode 精确调用某个账号
    codes: accounts.map(a => a.code).filter(Boolean),
    flatMap: Object.keys(flatMap).length > 0 ? flatMap : undefined,
  })
}

// 账号 → 打码后的结构（secure 字段只给 key/title，不给 value）
function maskAccount(account: Account) {
  return {
    id: account.id,
    // 项目码：5 位数字，全库唯一，可用于精确调用该账号
    code: account.code,
    fields: account.fields.map(f => ({
      key: f.key,
      title: f.title,
      value: f.secure ? "*** (加密隐藏)" : f.value,
      secure: !!f.secure,
    })),
  }
}

// 首个账号的非 secure 字段键值映射（附项目码）
function flatMapOf(account: Account): Record<string, string> | undefined {
  if (!account) return undefined
  const flatMap: Record<string, string> = {}
  for (const f of account.fields) {
    if (f.key && !f.secure && f.value) flatMap[f.key] = f.value
  }
  if (account.code) flatMap["code"] = account.code
  return Object.keys(flatMap).length > 0 ? flatMap : undefined
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
