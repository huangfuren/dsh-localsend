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

/** 构造 robocopy 参数;destDir 为目标目录,src 为单文件或目录。 */
export function buildRobocopyArgs(destDir, src, { timeoutMs = 120_000 } = {}) {
  const srcStat = fs.statSync(src)
  const srcDir = srcStat.isDirectory() ? src : path.dirname(src)
  const leaf = srcStat.isDirectory() ? path.basename(src) : path.basename(src)
  const destBase = `${destDir}\\${leaf}`
  const files = srcStat.isDirectory() ? [] : [path.basename(src)]
  // /E 含子目录; /Z 断点续传; /COPY:DAT 仅复制数据+属性+时间戳(不复制 ACL);
  // /R:2 /W:2 失败重试克制; /MT:8 多线程; /NFL /NDL /NC /NS /NP 减日志。
  const args = [
    `"${srcDir}"`, `"${destBase}"`, ...files.map((f) => `"${f}"`),
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
    await run('net', ['use', targetDir, ...args], { timeoutMs })
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString()
    if (/86/.test(msg) || /password/.test(msg)) throw new Error(`SMB 登录失败:用户名或密码不正确(微软账户请用账户密码,不是 PIN)。${msg.trim()}`)
    if (/5\b/.test(msg) || /Access is denied/.test(msg)) throw new Error(`SMB 访问被拒:目标机需关闭"密码保护的共享"并允许不安全来宾登录。${msg.trim()}`)
    if (/53\b/.test(msg) || /network path/.test(msg)) throw new Error(`SMB 找不到网络路径:目标机离线、共享名不存在或防火墙挡住 445 端口。${msg.trim()}`)
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
