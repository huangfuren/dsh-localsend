// lib/smb.js — SMB 推送:把本地文件/文件夹经 Windows 文件共享复制到目标机器的指定目录。
// 接收方**无需安装任何软件**(只要预先开一个共享文件夹,给发送方账户读写权限)。这是实现
// "无软件 + 指定目标 IP + 指定落盘目录 + 全自动" 诉求的通道(LocalSend 通道强制接收方装 App,
// 浏览器链接通道无法指定落盘目录)。零第三方依赖:仅用 Node 内置模块 + 调用系统 net/robocopy。
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 把主机名或 IP 规范化(去空格/反斜杠)。 */
export function normalizeHost(host) {
  return String(host || '').trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
}

/** 把共享名规范化(去首尾反斜杠)。 */
export function normalizeShare(share) {
  return String(share || '').trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
}

/**
 * 在档案列表里按名查找一条目标机档案(来自 settings 的 smbProfiles)。
 * @param {Array<object>} profiles 配置里的 smbProfiles 数组。
 * @param {string} name 档案名(去首尾空格,大小写敏感)。
 * @returns {object|null} 命中返回档案对象;name 为空时返回 null(表示未使用档案)。
 * @throws {Error} 提供了 name 但找不到时抛出,错误信息里列出已配置的档案名。
 */
export function findProfile(profiles, name) {
  const key = String(name ?? '').trim()
  if (!key) return null
  const list = Array.isArray(profiles) ? profiles : []
  const hit = list.find((p) => p && String(p.name ?? '').trim() === key)
  if (!hit) {
    const names = list.map((p) => String((p && p.name) ?? '').trim()).filter(Boolean)
    throw new Error(
      `smb: profile "${key}" not found` +
      (names.length ? ` (available: ${names.join(', ')})` : ' (no profiles configured)'),
    )
  }
  return hit
}

/**
 * 合并「档案 + 调用参数」:显式参数优先,缺省时回落到档案字段。
 * 空字符串视为「未提供」而回落到档案(密码同样按"非空即覆盖"处理)。
 * @param {object|null} profile 命中的档案(可为 null)。
 * @param {object} args 工具调用参数(target/share/destDir/username/password)。
 * @returns {{host:string, share:string, destDir:string, username:string, password:string}}
 */
export function mergeProfile(profile, args = {}) {
  const p = profile || {}
  const pick = (v, fallback) => {
    const s = (v === undefined || v === null) ? '' : String(v).trim()
    return s !== '' ? s : String(fallback ?? '').trim()
  }
  const rawPassword = (args.password === undefined || args.password === null) ? '' : String(args.password)
  return {
    host: pick(args.target, p.host),
    share: pick(args.share, p.share),
    destDir: pick(args.destDir, p.destDir),
    username: pick(args.username, p.username),
    password: rawPassword !== '' ? rawPassword : String(p.password ?? ''),
  }
}

/**
 * 拼出 UNC 共享根路径 \\host\share。
 * @param {string} host 主机名或 IPv4
 * @param {string} share 共享名
 * @returns {string} 例如 \\10.0.0.5\recv
 */
export function buildShareRoot(host, share) {
  const h = normalizeHost(host)
  const s = normalizeShare(share)
  if (!h) throw new Error('smb: host is required (IP or hostname)')
  if (!s) throw new Error('smb: share name is required (the folder name shared on the target machine)')
  return `\\\\${h}\\${s}`
}

/**
 * 拼出 UNC 目标目录 \\host\share\subdir。
 * @param {string} host
 * @param {string} share
 * @param {string} [subdir] 共享下的子目录(可多级),null/'' => 共享根
 * @returns {string}
 */
export function buildTargetDir(host, share, subdir) {
  const root = buildShareRoot(host, share)
  const sub = String(subdir || '').trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
  return sub ? `${root}\\${sub.replace(/\//g, '\\')}` : root
}

/** 构造 net use 命令参数(供测试/审计),不实际执行。 */
export function buildNetUseArgs(targetDir, { username, password } = {}) {
  const args = [targetDir]
  const u = String(username || '').trim()
  const p = String(password || '')
  if (!u && !p) {
    // 匿名/来宾登录(目标需关闭密码保护共享 + 允许不安全来宾登录)
    args.push('/user:guest', '""')
  } else if (u && !p) {
    args.push(`/user:${u}`)
  } else if (u && p) {
    args.push(`/user:${u}`, p)
  } else {
    // 有密码无用户名:交给当前 Windows 凭据(常见于域/微软账户自动)
    args.push(p)
  }
  args.push('/persistent:no')
  return args
}

/**
 * 构造 robocopy 参数;destDir 为目标目录,src 为单文件或目录。
 * ⚠️ robocopy 的「目标」参数**恒为目录**(不是最终文件名),因此两种模式的目标不同:
 *  - 目录:目标就是最终目录 `<destDir>\<leaf>`,把 src 的**内容**复制进去;
 *  - 单文件:目标必须是 `<destDir>` 本身,文件名以第三个位置参数传入,最终落在 `<destDir>\<leaf>`。
 *    曾经单文件也把目标写成 `<destDir>\<leaf>`,robocopy 便先建出这个目录再把文件放进去,
 *    结果多出一层同名目录(`…\leaf\leaf`)。
 * @returns {{srcDir:string, destBase:string, args:string[], timeoutMs:number}} 单文件时 destBase 即 destDir。
 */
export function buildRobocopyArgs(destDir, src, { timeoutMs = 120_000 } = {}) {
  const srcStat = fs.statSync(src)
  const isDir = srcStat.isDirectory()
  const srcDir = isDir ? src : path.dirname(src)
  const leaf = path.basename(src)
  const destBase = isDir ? `${destDir}\\${leaf}` : destDir
  const files = isDir ? [] : [leaf]
  // ⚠️ 参数必须是**裸值**：execFile 不经 shell，参数里的引号会被原样交给 robocopy，
  // 而 robocopy 自己不做引号剥离 —— 带引号的路径会让它直接以 exit 16 拒绝执行。
  // 实测：带引号 exit=16 且一个文件都没复制；裸参数 exit=1 且文件正确落盘。
  // /E 含子目录; /Z 断点续传; /COPY:DAT 仅复制数据+属性+时间戳(不复制 ACL);
  // /R:2 /W:2 失败重试克制; /MT:8 多线程; /NFL /NDL /NC /NS /NP 减日志。
  const args = [
    srcDir, destBase, ...files,
    '/E', '/Z', '/COPY:DAT', '/R:2', '/W:2', '/MT:8', '/NFL', '/NDL', '/NC', '/NS', '/NP',
  ]
  return { srcDir, destBase, args, timeoutMs }
}

function run(cmd, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    execFileAsync(cmd, args, { windowsHide: true, timeout: timeoutMs })
      .then(({ stdout, stderr }) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ stdout, stderr, code: 0 }) } })
      .catch((err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // robocopy 退出码 <8 表示成功(0=无复制,1=复制成功,2=额外);>=8 才失败。
        if (cmd === 'robocopy' && typeof err.code === 'number' && err.code < 8) {
          resolve({ stdout: (err.stdout || ''), stderr: (err.stderr || ''), code: err.code })
          return
        }
        reject(Object.assign(err, { stdout: err.stdout || '', stderr: err.stderr || '' }))
      })
  })
}

/**
 * 挂载 SMB 共享(建立会话)。失败时抛出可读错误。
 * @returns {Promise<{usedGuest:boolean}>}
 */
export async function mountShare(targetDir, { username, password, timeoutMs = 30_000 } = {}) {
  const args = buildNetUseArgs(targetDir, { username, password })
  try {
    // ⚠️ buildNetUseArgs 的返回值**已把 targetDir 作为首个位置参数**，这里不能再单独拼一次。
    // 曾经写成 ['use', targetDir, ...args] → net 收到两个 devicename + 凭据共 4 个位置参数，
    // 直接打印用法说明（语法错误），带凭据与来宾登录两条路径都必然挂。
    await run('net', ['use', ...args], { timeoutMs })
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString()
    if (/86/.test(msg) || /password/.test(msg)) throw new Error(`SMB 登录失败:用户名或密码不正确(微软账户请用账户密码,不是 PIN)。${msg.trim()}`)
    if (/5\b/.test(msg) || /Access is denied/.test(msg)) throw new Error(`SMB 访问被拒:目标机需关闭"密码保护的共享"并允许不安全来宾登录。${msg.trim()}`)
    if (/53\b/.test(msg) || /67\b/.test(msg) || /network path|network name/i.test(msg)) throw new Error(`SMB 找不到网络路径:目标机离线、共享名不存在或防火墙挡住 445 端口。${msg.trim()}`)
    throw new Error(`SMB 挂载失败:${msg.trim()}`)
  }
  return { usedGuest: !username && !password }
}

/** 断开 SMB 共享(尽力而为)。 */
export async function unmountShare(targetDir, { timeoutMs = 15_000 } = {}) {
  try { await run('net', ['use', targetDir, '/delete', '/y'], { timeoutMs }) } catch { /* 忽略 */ }
}

/**
 * 复制本地路径到已挂载的 UNC 目标目录。
 * @returns {Promise<{destBase:string, exitCode:number}>}
 */
export async function copyToTarget(destDir, src, { timeoutMs = 120_000 } = {}) {
  const { args, destBase } = buildRobocopyArgs(destDir, src, { timeoutMs })
  const res = await run('robocopy', args, { timeoutMs })
  return { destBase, exitCode: res.code ?? 0, stdout: res.stdout || '' }
}
