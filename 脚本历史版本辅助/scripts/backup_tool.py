#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ScriptBackups 历史备份工具 —— 配合「脚本管理工具」使用。

用途：在 ScriptBackups 目录中查找历史版本的 .scripting 备份，
      提取包内代码、按关键词搜索，帮助从旧版恢复/移植功能。
      也支持按用户要求从 GitHub 发布仓库下载 .scripting 到本地再读取。

命令：
  list  [--script 脚本名]                 列出备份目录中的 .scripting 备份
  find  <脚本名> [版本号]                  按脚本名（+可选版本）查找 .scripting 备份
  fetch <脚本名> [--repo 仓库]             从 GitHub 下载 .scripting 到临时目录（默认 vvvvvveng/Scripting-releases）
  info  <备份文件路径>                     显示备份内 script.json 摘要（名称/版本/入口）
  files <备份文件路径> [--dir 子目录]       列出备份 zip 内文件清单（含大小）
  extract <备份文件路径> --file 内部路径    打印 zip 内某个文本文件的内容
          [--range 开始行:结束行]           只打印指定行范围（1 起，如 100:200，留空表示到结尾）
  search <备份文件路径> <关键词>            在 zip 内所有文本文件中搜索关键词
          [--context N] [--file 文件名] [--regex]
                                            --file 只搜索指定文件名（自动匹配 basename）

规则：
  - 只读取 .scripting 备份；拒绝 全部_*.zip 之类的打包 zip（不从中读取脚本）。
  - .scripting 备份是标准 zip 包，内部条目形如「脚本名/index.tsx」。
  - fetch 下载的文件放在 workspace 临时目录，读取后按需清理。
  - 本脚本只读本地备份，绝不修改备份文件。
"""
import sys, os, re, json, zipfile, argparse, urllib.request, urllib.parse, ssl
from datetime import datetime

# iOS 环境 Python 缺 CA 证书，GitHub 请求统一用不验证证书的 context
_SSL_CTX = ssl._create_unverified_context()

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

def _detect_sandbox_backups_dir():
    """从 TMPDIR 环境变量自动推导 iPhone 本地沙盒 ScriptBackups 路径（不同设备/用户自动适配）。"""
    tmpdir = os.environ.get("TMPDIR", "")
    if tmpdir:
        # TMPDIR = <app沙盒>/tmp/
        # 去掉尾部 /tmp/（或 /tmp/xx/）得到 app 沙盒根
        idx = tmpdir.rfind("/tmp")
        if idx != -1:
            sandbox_root = tmpdir[:idx]
            candidate = os.path.join(sandbox_root, "Documents", "ScriptBackups")
            if os.path.isdir(candidate):
                return candidate
    return None


def _default_tmp_dir():
    """临时下载目录：优先 TMPDIR 环境变量（沙盒临时目录），无则退回 /tmp。"""
    return os.environ.get("TMPDIR") or "/tmp"


def _detect_icloud_backups_dir():
    """从 iCloud Mobile Documents 容器自动推导 ScriptBackups（destination 为 icloud 时）。
    扫描 ~/Library/Mobile Documents 下 iCloud~*~Scripting 容器，不写死任何账户名。"""
    mobile_docs = os.path.join(os.path.expanduser("~"), "Library", "Mobile Documents")
    try:
        for name in os.listdir(mobile_docs):
            if name.startswith("iCloud~") and name.endswith("~Scripting"):
                cand = os.path.join(mobile_docs, name, "Documents", "ScriptBackups")
                if os.path.isdir(cand):
                    return cand
    except OSError:
        pass
    return None


# 主目录（自动探测，不同设备/用户自动适配）
BACKUPS_DIR = _detect_sandbox_backups_dir()
# 备用（destination 为 icloud 时的历史位置；同样动态探测）
BACKUPS_DIR_FALLBACK = _detect_icloud_backups_dir()
# 都探测不到时的兜底：主目录回退到沙盒路径，备用回退到 iCloud 根（用于报错提示）
if not BACKUPS_DIR and not BACKUPS_DIR_FALLBACK:
    BACKUPS_DIR = os.path.join(os.path.expanduser("~"), "Library", "Mobile Documents")
GITHUB_REPO = "vvvvvveng/Scripting-releases"
TMP_DIR = _default_tmp_dir()
VERSION_RE = re.compile(r"^(.*)_(\d+\.\d+\.\d+)\.scripting$")
TEXT_EXTS = {
    ".tsx", ".ts", ".js", ".jsx", ".json", ".md", ".txt", ".css",
    ".html", ".htm", ".yml", ".yaml", ".py", ".swift", ".plist",
    ".user.js", ".properties", ".ini", ".csv",
}


def norm(s):
    return re.sub(r"\s+", "", s or "")


def split_backup_name(fname):
    """把 '脚本名_1.0.1.scripting' 拆成 (脚本名, 版本号)；不含版本号返回 (fname, None)。"""
    m = VERSION_RE.match(fname)
    if m:
        return m.group(1), m.group(2)
    return fname, None


def resolve_backups_dir():
    """返回实际存在的备份目录（优先 iPhone 本地沙盒，回退 iCloud）。"""
    for d in (BACKUPS_DIR, BACKUPS_DIR_FALLBACK):
        if d and os.path.isdir(d):
            return d
    return BACKUPS_DIR or BACKUPS_DIR_FALLBACK or ""


def list_backups(script_filter=None):
    """返回备份目录中的 .scripting 条目列表（dict）。只收 .scripting，忽略 zip。"""
    out = []
    d = resolve_backups_dir()
    if not os.path.isdir(d):
        print(f"[错误] 备份目录不存在: {d}")
        return out
    for name in sorted(os.listdir(d)):
        if not name.endswith(".scripting"):
            continue  # 只读 .scripting，跳过 zip 打包备份
        path = os.path.join(d, name)
        if os.path.isdir(path):
            continue
        try:
            st = os.stat(path)
            mtime = datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")
        except OSError:
            mtime, st = "-", None
        sname, ver = split_backup_name(name)
        hit = True
        if script_filter:
            f = norm(script_filter)
            hit = bool(f) and f in norm(sname)
        out.append({
            "name": name, "path": path, "script": sname, "version": ver,
            "mtime": mtime, "size": st.st_size if st else 0, "hit": hit,
        })
    return out


def ensure_scripting(path):
    """校验传入的是 .scripting 备份；zip 打包备份一律拒绝。"""
    if not os.path.isfile(path):
        print(f"[错误] 文件不存在: {path}")
        return False
    if not path.endswith(".scripting"):
        print(f"[拒绝] 只读取 .scripting 备份，不读取 zip 打包备份（{os.path.basename(path)}）。")
        return False
    return True


def cmd_list(args):
    items = list_backups(args.script)
    if not items:
        print("（备份目录中没有 .scripting 备份）")
        return
    if args.script:
        shown = [i for i in items if i["hit"]]
        print(f"包含「{args.script}」的 .scripting 备份：")
        for i in shown:
            print(f"  {i['name']}   [版本 {i['version'] or '?'} | {i['mtime']} | {i['size']//1024} KB]")
        if not shown:
            print("  未找到匹配项（只读 .scripting，不读 zip 打包备份）")
        return
    print(f"备份目录（.scripting）: {resolve_backups_dir()}")
    for i in items:
        print(f"  {i['name']}   [版本 {i['version'] or '?'} | {i['mtime']} | {i['size']//1024} KB]")


def cmd_find(args):
    items = list_backups(args.name)
    cands = [i for i in items if i["hit"]]
    if not cands:
        print(f"[未找到] 名为「{args.name}」的 .scripting 备份。可用 list 查看备份目录（只读 .scripting，不读 zip）。")
        return
    if args.version:
        v = args.version
        cands = [i for i in cands if i["version"] is not None and (
            i["version"] == v or i["version"].startswith(v)
        )]
    if not cands:
        print(f"[未找到] 脚本「{args.name}」版本 {args.version} 的 .scripting 备份。")
        return
    print(f"匹配「{args.name}」的 .scripting 备份：")
    for i in sorted(cands, key=lambda x: x["version"] or ""):
        print(f"  {i['name']}  [版本 {i['version']} | {i['mtime']} | {i['size']//1024} KB]")


def api_get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "scripting-history-reference",
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as r:
        return json.loads(r.read().decode("utf-8"))


def cmd_fetch(args):
    """从 GitHub 仓库下载 .scripting 到临时目录（只下载 .scripting，不下载其他文件）。"""
    repo = args.repo or GITHUB_REPO
    print(f"查询 GitHub 仓库 {repo} ...")
    try:
        items = api_get(f"https://api.github.com/repos/{repo}/contents/")
    except Exception as e:
        print(f"[错误] 无法访问 GitHub 仓库: {e}")
        return
    targets = [it for it in items if it.get("type") == "file" and it.get("name", "").endswith(".scripting")]
    if not targets:
        print("[未找到] 仓库中没有 .scripting 文件。")
        return
    f = norm(args.name)
    matched = [it for it in targets if f in norm(it["name"])]
    if not matched:
        print(f"[未找到] 仓库中没有匹配「{args.name}」的 .scripting 文件。仓库内 .scripting 文件如下：")
        print("仓库内 .scripting 文件：")
        for it in targets:
            print(f"  {it['name']}")
        return
    os.makedirs(TMP_DIR, exist_ok=True)
    for it in matched:
        fname = it["name"]
        dest = os.path.join(TMP_DIR, fname)
        url = it.get("download_url")
        if not url:
            print(f"[跳过] {fname} 无下载地址")
            continue
        # 中文路径需要百分号编码
        url = urllib.parse.quote(url, safe=":/?&=%")
        print(f"下载 {fname} ...")
        try:
            with urllib.request.urlopen(url, timeout=60, context=_SSL_CTX) as r, open(dest, "wb") as f:
                f.write(r.read())
            print(f"已保存: {dest} ({os.path.getsize(dest)//1024} KB)")
            print(f"提示: 用 info/extract/search 读取该文件；读取后如需清理可删除临时文件。")
        except Exception as e:
            print(f"[错误] 下载失败: {e}")


def open_zip(path):
    if not ensure_scripting(path):
        return None
    try:
        return zipfile.ZipFile(path)
    except Exception as e:
        print(f"[错误] 无法打开备份 {path}: {e}")
        return None


def cmd_info(args):
    z = open_zip(args.path)
    if not z:
        return
    names = z.namelist()
    script_json = None
    for n in names:
        if n.endswith("script.json"):
            script_json = n
            break
    if not script_json:
        print(f"[提示] 备份内未找到 script.json。顶层目录：")
        tops = sorted(set(n.split("/")[0] for n in names if "/" in n))
        for t in tops:
            print("  ", t)
        return
    try:
        with z.open(script_json) as f:
            data = json.load(f)
        print(f"备份: {os.path.basename(args.path)}")
        print(f"  脚本名: {data.get('localizedNames', {}).get('zh') or data.get('name')}")
        print(f"  版本号: {data.get('version', '?')}")
        print(f"  入口:   {data.get('entry', '?')}")
        print(f"  描述:   {data.get('description', '')[:120]}")
    except Exception as e:
        print(f"[错误] 读取 script.json 失败: {e}")


def is_text_entry(name):
    if name.endswith("/"):
        return False
    base = os.path.basename(name)
    if base.startswith(".") and "." in base:
        return True
    ext = os.path.splitext(base)[1].lower()
    return ext in TEXT_EXTS


def cmd_files(args):
    z = open_zip(args.path)
    if not z:
        return
    names = z.namelist()
    prefix = args.dir.strip("/") + "/" if args.dir else ""
    rows = []
    for n in names:
        if n.endswith("/"):
            continue
        if prefix and not n.startswith(prefix):
            continue
        rows.append((n, z.getinfo(n).file_size))
    print(f"{os.path.basename(args.path)} 内文件（共 {len(rows)} 个）：")
    for n, size in sorted(rows):
        print(f"  {n:55s} {size:>10d} B")


def resolve_entry(z, file_arg):
    """按 --file 参数匹配 zip 条目：先精确，再按 basename 相等，最后按包含。"""
    names = z.namelist()
    if file_arg in names:
        return file_arg
    base = os.path.basename(file_arg.rstrip("/"))
    for n in names:
        if os.path.basename(n) == base:
            return n
    for n in names:
        if file_arg in n:
            return n
    return None


def read_lines(z, entry):
    with z.open(entry) as f:
        raw = f.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None
    return text.splitlines()


def cmd_extract(args):
    z = open_zip(args.path)
    if not z:
        return
    entry = resolve_entry(z, args.file)
    if not entry:
        print(f"[错误] 备份内未找到文件「{args.file}」。可用 files 查看清单。")
        return
    lines = read_lines(z, entry)
    if lines is None:
        info = z.getinfo(entry)
        print(f"文件: {entry}  大小: {info.file_size} B（非文本，未打印内容）")
        return
    total = len(lines)
    if args.range:
        m = re.match(r"^(\d*):(\d*)$", args.range)
        if not m:
            print("[错误] --range 格式应为 开始行:结束行（如 100:200，可留空）")
            return
        start = int(m.group(1)) if m.group(1) else 1
        end = int(m.group(2)) if m.group(2) else total
        start, end = max(1, start), min(total, end)
        print(f"文件: {entry}  共 {total} 行，显示 {start}-{end} 行")
        for i in range(start - 1, end):
            print(f"{i+1:6d}| {lines[i]}")
    else:
        print(f"文件: {entry}  共 {total} 行（全部打印）")
        for i, line in enumerate(lines, 1):
            print(f"{i:6d}| {line}")


def cmd_search(args):
    z = open_zip(args.path)
    if not z:
        return
    if args.regex:
        pat = re.compile(args.keyword)
    else:
        pat = re.compile(re.escape(args.keyword))
    ctx = max(0, args.context)
    hits = 0
    for n in z.namelist():
        if not is_text_entry(n):
            continue
        if args.file and os.path.basename(args.file) != os.path.basename(n):
            continue
        lines = read_lines(z, n)
        if lines is None:
            continue
        matched = [i for i, ln in enumerate(lines) if pat.search(ln)]
        if not matched:
            continue
        print(f"===== {n} （命中 {len(matched)} 处） =====")
        printed = set()
        for idx in matched:
            lo, hi = max(0, idx - ctx), min(len(lines), idx + ctx + 1)
            for i in range(lo, hi):
                if i in printed:
                    continue
                printed.add(i)
                mark = ">>" if i == idx else "  "
                print(f"{mark}{i+1:5d}| {lines[i]}")
            hits += 1
        print()
    if hits == 0:
        print(f"[未命中] 关键词「{args.keyword}」")
    else:
        print(f"共命中 {hits} 处")


def main():
    ap = argparse.ArgumentParser(description="ScriptBackups 历史备份工具（只读 .scripting）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="列出备份目录中的 .scripting 备份")
    p_list.add_argument("--script", help="按脚本名过滤")
    p_list.set_defaults(fn=cmd_list)

    p_find = sub.add_parser("find", help="按脚本名查找 .scripting 备份")
    p_find.add_argument("name", help="脚本名，如 🐝浏览器")
    p_find.add_argument("version", nargs="?", help="版本号，如 1.0.1")
    p_find.set_defaults(fn=cmd_find)

    p_fetch = sub.add_parser("fetch", help="从 GitHub 下载 .scripting 到临时目录")
    p_fetch.add_argument("name", help="脚本名，如 🐝浏览器")
    p_fetch.add_argument("--repo", default=None, help="GitHub 仓库（默认 vvvvvveng/Scripting-releases）")
    p_fetch.set_defaults(fn=cmd_fetch)

    p_info = sub.add_parser("info", help="查看备份内 script.json 摘要")
    p_info.add_argument("path")
    p_info.set_defaults(fn=cmd_info)

    p_files = sub.add_parser("files", help="列出备份 zip 内文件")
    p_files.add_argument("path")
    p_files.add_argument("--dir", default="", help="只列指定子目录")
    p_files.set_defaults(fn=cmd_files)

    p_ex = sub.add_parser("extract", help="打印备份内文本文件内容")
    p_ex.add_argument("path")
    p_ex.add_argument("--file", required=True, help="内部文件路径，如 index.tsx 或 脚本名/index.tsx")
    p_ex.add_argument("--range", default=None, help="行范围 开始:结束，如 100:200")
    p_ex.set_defaults(fn=cmd_extract)

    p_se = sub.add_parser("search", help="在备份内搜索关键词")
    p_se.add_argument("path")
    p_se.add_argument("keyword", help="搜索关键词")
    p_se.add_argument("--context", type=int, default=2, help="上下文行数（默认 2）")
    p_se.add_argument("--file", default=None, help="限定搜索的文件名")
    p_se.add_argument("--regex", action="store_true", help="把关键词当正则")
    p_se.set_defaults(fn=cmd_search)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
