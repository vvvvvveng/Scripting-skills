// maintain_meta.ts
// 维护 Scripting 脚本的元信息：作者信息 check-author（name/email/homepage）+ 版本号 bump
// + 智能体修改标记 mark-agent-modified（供脚本管理工具自动备份识别“手动修改”）
// + 智能体修改说明 write-change-note（把本次修改说明写入脚本目录 .change_notes，随备份带走）
// + 远程资源链接清理 clean-update-url（自动去掉 remoteResource.url 里 ?t=<时间戳> 防缓存参数）
// 注意：运行完成后调用 Script.exit 主动返回结果，避免 scripting-ts run 一直挂起等待到超时。
import { Script } from "scripting"
// 用法：
//   check-author: --queryparameters '{"action":"check-author","project":"<脚本名或路径>"}'
//   bump:         --queryparameters '{"action":"bump","project":"<脚本名或路径>","level":"patch|minor|major","dryRun":true}'
//   mark-agent-modified: --queryparameters '{"action":"mark-agent-modified","configPath":"<脚本管理工具配置绝对路径>","project":"<脚本名>"}'
//   write-change-note: --queryparameters '{"action":"write-change-note","project":"<脚本名或路径>","note":"<修改说明内容>"}'
//   clean-update-url: --queryparameters '{"action":"clean-update-url","project":"<脚本名或路径>","dryRun":true}'
//   check-author / bump / clean-update-url 都会顺带清理 remoteResource.url 里形如 ?t=1787666102311 的时间戳参数。
//   check-author 会把 author 补全为 config.json 的完整信息；脚本已有其他作者（name ≠ 用户）时不动 author。

/** 智能体修改说明文件名：写入脚本目录，供脚本管理工具自动备份时随包带走、恢复时展示 */
const CHANGE_NOTES_FILENAME = ".change_notes"

interface Author {
  name?: string | null
  email?: string | null
  homepage?: string | null
}

interface RemoteResource {
  url?: string | null
  hash?: string | null
  autoUpdateInterval?: number
}

interface ScriptMeta {
  name?: string
  version?: string
  author?: Author | null
  remoteResource?: RemoteResource | null
  [key: string]: unknown
}

type Level = "patch" | "minor" | "major"

interface CleanUrlResult {
  cleaned: string
  changed: boolean
}

// 清理远程资源链接里形如 ?t=<时间戳> 的防缓存参数（如 https://.../xx.scripting?t=1787666102311）
// 规则：query 里的 t 参数是纯数字（时间戳）时删掉它；删完后没有其他参数则连 ? 一起去掉。
function cleanRemoteUrl(url: string | null | undefined): CleanUrlResult {
  if (!url) {
    return { cleaned: "", changed: false }
  }
  const m = /^([^?]+)\?([^#]*)(#.*)?$/.exec(url)
  if (!m) {
    return { cleaned: url, changed: false }
  }
  const base = m[1]
  const hash = m[3] ?? ""
  const params = m[2].split("&").filter((p) => p.length > 0)
  const before = params.length
  const kept = params.filter((p) => {
    const eq = p.indexOf("=")
    const key = eq === -1 ? p : p.slice(0, eq)
    const val = eq === -1 ? "" : p.slice(eq + 1)
    return !(key === "t" && /^\d+$/.test(val))
  })
  if (kept.length === before) {
    return { cleaned: url, changed: false }
  }
  const cleaned = kept.length > 0 ? `${base}?${kept.join("&")}${hash}` : `${base}${hash}`
  return { cleaned, changed: true }
}

function getProjectDir(project: string): string {
  const scriptsDir = FileManager.scriptsDirectory.replace(/\/+$/, "")
  if (project.startsWith("/")) {
    return project.replace(/\/+$/, "")
  }
  return scriptsDir + "/" + project
}

function loadConfig(): { author: Author } {
  // Script.directory 指向 skill 根目录（含 config.json），而非 scripts/ 子目录
  const configPath = (Script.directory.replace(/\/+$/, "")) + "/config.json"
  const text = FileManager.readAsStringSync(configPath)
  return JSON.parse(text)
}

function readScriptJson(projectDir: string): ScriptMeta {
  const p = projectDir + "/script.json"
  if (!FileManager.existsSync(p)) {
    throw new Error("script.json 不存在: " + p)
  }
  return JSON.parse(FileManager.readAsStringSync(p))
}

function writeScriptJson(projectDir: string, meta: ScriptMeta): void {
  const p = projectDir + "/script.json"
  FileManager.writeAsStringSync(p, JSON.stringify(meta, null, 2) + "\n")
}

function bumpVersion(version: string, level: Level): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version.trim())
  if (!m) {
    throw new Error("无法解析版本号: " + version)
  }
  let major = parseInt(m[1], 10)
  let minor = parseInt(m[2], 10)
  let patch = parseInt(m[3], 10)
  if (level === "major") {
    major += 1
    minor = 0
    patch = 0
  } else if (level === "minor") {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `${major}.${minor}.${patch}`
}

async function main(): Promise<Record<string, unknown>> {
  const params = (Script.queryParameters ?? {}) as Record<string, unknown>
  const project = String(params.project ?? "").trim()
  const action = String(params.action ?? "check-author").trim()
  const dryRun = params.dryRun === true || params.dryRun === "true"

  if (!project) {
    throw new Error("缺少 project 参数（脚本目录名或绝对路径）")
  }

  const projectDir = getProjectDir(project)

  if (action === "check-author") {
    const config = loadConfig()
    const desiredName = config.author?.name
    if (!desiredName) {
      throw new Error("config.json 中缺少 author.name")
    }
    const meta = readScriptJson(projectDir)
    const existing = meta.author ?? null
    const existingName = existing?.name ?? null

    // 已有其他作者（author.name 存在且 ≠ 用户作者名）：不改动 author 任何内容
    const isOtherAuthor = existingName != null && existingName !== desiredName

    const newAuthor: Author = {
      name: desiredName,
      email: config.author.email ?? null,
      homepage: config.author.homepage ?? null,
    }
    const same =
      existing != null &&
      existing.name === newAuthor.name &&
      (existing.email ?? null) === newAuthor.email &&
      (existing.homepage ?? null) === newAuthor.homepage
    const changed = isOtherAuthor ? false : !same

    // 顺带清理远程资源链接（Scripting 应用里长按脚本设置的远程资源 URL）的 ?t=<时间戳> 参数
    const urlBefore = meta.remoteResource?.url ?? null
    let urlAfter: string | null = urlBefore
    let urlCleaned = false
    if (urlBefore) {
      const r = cleanRemoteUrl(urlBefore)
      urlAfter = r.cleaned
      urlCleaned = r.changed
    }

    if (!dryRun && (changed || urlCleaned)) {
      if (changed) {
        meta.author = newAuthor
      }
      if (urlCleaned && meta.remoteResource) {
        meta.remoteResource.url = urlAfter
      }
      writeScriptJson(projectDir, meta)
    }

    const result = {
      action,
      project: projectDir,
      before: existingName,
      after: isOtherAuthor ? existingName : desiredName,
      changed,
      skippedOtherAuthor: isOtherAuthor,
      updateUrlBefore: urlBefore,
      updateUrlAfter: urlAfter,
      updateUrlCleaned: urlCleaned,
      dryRun,
      version: meta.version ?? null,
    }
    console.log(JSON.stringify(result))
    return result
  } else if (action === "bump") {
    const level = String(params.level ?? "patch").trim() as Level
    if (!["patch", "minor", "major"].includes(level)) {
      throw new Error("level 必须是 patch / minor / major")
    }
    const meta = readScriptJson(projectDir)
    const oldVersion = meta.version || "0.0.0"
    const newVersion = bumpVersion(oldVersion, level)

    // 顺带清理远程资源链接的 ?t=<时间戳> 参数
    const urlBefore = meta.remoteResource?.url ?? null
    let urlAfter: string | null = urlBefore
    let urlCleaned = false
    if (urlBefore) {
      const r = cleanRemoteUrl(urlBefore)
      urlAfter = r.cleaned
      urlCleaned = r.changed
    }

    if (!dryRun) {
      meta.version = newVersion
      if (urlCleaned && meta.remoteResource) {
        meta.remoteResource.url = urlAfter
      }
      writeScriptJson(projectDir, meta)
    }

    const result = {
      action,
      project: projectDir,
      level,
      oldVersion,
      newVersion,
      updateUrlBefore: urlBefore,
      updateUrlAfter: urlAfter,
      updateUrlCleaned: urlCleaned,
      dryRun,
    }
    console.log(JSON.stringify(result))
    return result
  } else if (action === "clean-update-url") {
    const meta = readScriptJson(projectDir)
    const urlBefore = meta.remoteResource?.url ?? null
    let urlAfter: string | null = urlBefore
    let changed = false
    if (urlBefore) {
      const r = cleanRemoteUrl(urlBefore)
      urlAfter = r.cleaned
      changed = r.changed
    }
    if (changed && !dryRun && meta.remoteResource) {
      meta.remoteResource.url = urlAfter
      writeScriptJson(projectDir, meta)
    }
    const result = {
      action,
      project: projectDir,
      updateUrlBefore: urlBefore,
      updateUrlAfter: urlAfter,
      changed,
      dryRun,
    }
    console.log(JSON.stringify(result))
    return result
  } else if (action === "mark-agent-modified") {
    const configPath = String(params.configPath ?? "").trim()
    if (!configPath) {
      throw new Error("缺少 configPath 参数（脚本管理工具配置绝对路径）")
    }
    // project 为脚本目录名（即自动备份里的 folderName）
    const folderName = project
    if (!folderName) {
      throw new Error("缺少 project 参数（脚本目录名）")
    }
    let config: Record<string, unknown> = {}
    if (FileManager.existsSync(configPath)) {
      try {
        config = JSON.parse(FileManager.readAsStringSync(configPath))
      } catch {
        config = {}
      }
    }
    const record =
      config.agentModifiedAt && typeof config.agentModifiedAt === "object"
        ? (config.agentModifiedAt as Record<string, number>)
        : {}
    const at = dryRun ? 0 : Date.now()
    record[folderName] = at
    if (!dryRun) {
      config.agentModifiedAt = record
      FileManager.writeAsStringSync(configPath, JSON.stringify(config, null, 2))
    }
    const result = {
      action,
      configPath,
      folderName,
      at,
      dryRun,
    }
    console.log(JSON.stringify(result))
    return result
  } else if (action === "write-change-note") {
    const note = String(params.note ?? "").trim()
    if (!note) {
      throw new Error("缺少 note 参数（修改说明内容）")
    }
    const notesPath = projectDir + "/" + CHANGE_NOTES_FILENAME
    if (!dryRun) {
      FileManager.writeAsStringSync(notesPath, note + "\n")
    }
    const result = {
      action,
      project: projectDir,
      notesPath,
      note,
      dryRun,
    }
    console.log(JSON.stringify(result))
    return result
  } else {
    throw new Error("未知 action: " + action + "（支持 check-author / bump / mark-agent-modified / write-change-note / clean-update-url）")
  }
}

main()
  .then((result) => Script.exit(result))
  .catch((e) => {
    const message = e instanceof Error ? e.message : String(e)
    console.error("maintain_meta 出错: " + message)
    Script.exit({ error: message })
  })
