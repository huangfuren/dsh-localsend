// lib/share.js — 局域网临时 HTTP 下载服务:生成一次性链接,接收方用浏览器打开即可下载。
// 发送端启动 HTTP 服务器 + 可选密码保护 + Range 断点续传 + 自动关闭。
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { mimeOf, fileNameOf } from './protocol.js'

// ─── helpers ───

/** 本机第一个非内部 IPv4 地址。 */
export function getLocalIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return '127.0.0.1'
}

/** 随机可用端口。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}

function token() {
  return crypto.randomBytes(16).toString('hex')
}

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._\-() ]/g, '_').slice(0, 200)
}

// ─── download page ───

function downloadPage({ alias, files, token: t, baseUrl }) {
  const fileRows = files.map((f, i) => {
    const url = files.length === 1 ? `${baseUrl}/dl/${t}` : `${baseUrl}/dl/${t}?i=${i}`
    const sizeStr = f.size < 1024 * 1024
      ? `${(f.size / 1024).toFixed(1)} KB`
      : f.size < 1024 * 1024 * 1024
        ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
        : `${(f.size / (1024 * 1024 * 1024)).toFixed(2)} GB`
    return `<div class="file">
  <div class="name">${escHtml(f.name)}</div>
  <div class="meta">${sizeStr}</div>
  <a class="btn" href="${escHtml(url)}" download="${escHtml(f.name)}">下载</a>
</div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(alias)} - 文件下载</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#1a1a2e;color:#e0e0e0;
  display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.card{background:#16213e;border-radius:16px;padding:32px;max-width:480px;width:100%;
  box-shadow:0 8px 32px rgba(0,0,0,.3)}
h1{font-size:18px;font-weight:600;margin-bottom:4px;color:#fff}
.sub{font-size:13px;color:#8892a8;margin-bottom:20px}
.file{display:flex;align-items:center;gap:12px;padding:12px 16px;
  background:#0f3460;border-radius:10px;margin-bottom:10px}
.name{flex:1;font-size:14px;font-weight:500;color:#fff;word-break:break-all}
.meta{font-size:12px;color:#8892a8;white-space:nowrap}
.btn{display:inline-flex;align-items:center;padding:8px 20px;
  background:#e94560;color:#fff;text-decoration:none;border-radius:8px;
  font-size:13px;font-weight:600;white-space:nowrap;transition:background .15s}
.btn:hover{background:#ff6b81}
.footer{margin-top:16px;font-size:11px;color:#555;text-align:center}
</style>
</head>
<body>
<div class="card">
  <h1>${escHtml(alias)}</h1>
  <div class="sub">${files.length} 个文件等待下载</div>
  ${fileRows}
  <div class="footer">由 dsh-localsend 生成 &middot; 链接一次有效，下载完成后自动关闭</div>
</div>
</body>
</html>`
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── HTTP handler ───

function createHandler(session) {
  return (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const parts = url.pathname.split('/').filter(Boolean)

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    // GET /dl/:token
    if (parts[0] === 'dl' && parts[1] === session.token && (req.method === 'GET' || req.method === 'HEAD')) {
      handleDownload(req, res, session, url)
      return
    }

    // GET / — 下载页(或单文件直接下载)
    if (parts.length === 0) {
      if (session.files.length === 1 && !session.password) {
        // 单文件: 直接 302 跳转下载
        res.writeHead(302, { Location: `/dl/${session.token}` })
        res.end()
        return
      }
      const html = downloadPage({
        alias: session.alias,
        files: session.files,
        token: session.token,
        baseUrl: `http://${getLocalIp()}:${session.port}`,
      })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  }
}

function handleDownload(req, res, session, url) {
  // 密码检查
  if (session.password) {
    const auth = req.headers.authorization || ''
    const expected = 'Basic ' + Buffer.from(`dsh:${session.password}`).toString('base64')
    if (auth !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dsh-localsend"' })
      res.end('Unauthorized')
      return
    }
  }

  // 支持单文件无索引、多文件有索引
  let idx = 0
  if (session.files.length > 1) {
    idx = parseInt(url.searchParams.get('i') || '0', 10)
  }
  if (idx < 0 || idx >= session.files.length) {
    res.writeHead(400); res.end('Invalid file index'); return
  }

  const file = session.files[idx]
  const safePath = path.resolve(file.path)
  if (!fs.existsSync(safePath)) {
    res.writeHead(404); res.end('File not found'); return
  }

  const stat = fs.statSync(safePath)
  const total = stat.size
  const mime = mimeOf(file.name)

  // Range 支持
  const range = req.headers.range
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range)
    if (m) {
      const start = parseInt(m[1], 10)
      const end = m[2] ? parseInt(m[2], 10) : total - 1
      if (start >= total || end >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` }); res.end(); return
      }
      const chunk = end - start + 1
      res.writeHead(206, {
        'Content-Type': mime,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': chunk,
        'Content-Disposition': `attachment; filename="${safeName(file.name)}"`,
        'Cache-Control': 'no-store',
      })
      if (req.method !== 'HEAD') {
        fs.createReadStream(safePath, { start, end }).pipe(res)
      } else {
        res.end()
      }
      if (req.method !== 'HEAD') trackDownload(res, session, idx)
      return
    }
  }

  // 完整下载
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': total,
    'Content-Disposition': `attachment; filename="${safeName(file.name)}"`,
    'Cache-Control': 'no-store',
  })
  if (req.method !== 'HEAD') {
    fs.createReadStream(safePath).pipe(res)
    trackDownload(res, session, idx)
  } else {
    res.end()
  }
}

function trackDownload(res, session, idx) {
  res.on('finish', () => {
    session.downloaded.add(idx)
    session.totalDownloaded += session.files[idx].size
    if (session.downloaded.size >= session.files.length) {
      setTimeout(() => shutdown(session, 'all files downloaded'), 500)
    }
  })
}

function shutdown(session, reason) {
  if (session.closed) return
  session.closed = true
  try { session.server.close() } catch { /* 忽略 */ }
  if (session.onDone) session.onDone(reason, session)
}

// ─── public API ───

/**
 * 创建临时下载会话。
 * @param {object} o
 * @param {string[]} o.files       要分享的文件绝对路径
 * @param {string} [o.alias]       显示在下载页的发送方名称
 * @param {string} [o.password]    下载密码(空=不用)
 * @param {number} [o.expiresIn]   有效期(秒),0=不过期(仅文件下完关)
 * @param {number} [o.port]        监听端口(0=随机)
 * @param {function} [o.onLog]     日志回调
 * @param {AbortSignal} [o.signal] 取消信号
 * @returns {Promise<{url:string, token:string, port:number, expires:Date|null, files:{name:string,size:number,sha256:string}[], close:Function}>}
 */
export async function createShareSession({
  files, alias = 'dsh-localsend', password = '', expiresIn = 3600,
  port = 0, onLog, signal,
} = {}) {
  const log = (s) => onLog && onLog(s)
  if (!Array.isArray(files) || files.length === 0) throw new Error('files is required')

  const fileMeta = []
  for (const fp of files) {
    const st = await fs.promises.stat(fp).catch(() => null)
    if (!st || !st.isFile()) throw new Error(`file not found or not a regular file: ${fp}`)
    const entry = { path: fp, name: fileNameOf(fp), size: st.size, sha256: '' }
    // 小于 64MB 计算 sha256，大文件跳过（避免内存爆炸）
    if (st.size <= 64 * 1024 * 1024) {
      const data = await fs.promises.readFile(fp)
      entry.sha256 = crypto.createHash('sha256').update(data).digest('hex')
    }
    fileMeta.push(entry)
  }

  const tok = token()
  const listenPort = port || await freePort()
  const expires = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null

  const session = {
    token: tok, port: listenPort, alias, password,
    files: fileMeta, server: null, closed: false,
    downloaded: new Set(), totalDownloaded: 0, onDone: null,
  }

  const handler = createHandler(session)
  const server = http.createServer(handler)
  session.server = server

  return new Promise((resolve, reject) => {
    server.listen(listenPort, '0.0.0.0', () => {
      const actualPort = server.address().port
      session.port = actualPort
      const ip = getLocalIp()
      const url = `http://${ip}:${actualPort}/dl/${tok}`
      log(`share server listening on ${ip}:${actualPort}`)
      log(`download URL: ${url}`)

      if (expiresIn > 0) {
        const timer = setTimeout(() => shutdown(session, 'expired'), expiresIn * 1000)
        if (signal) signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
      }
      if (signal) signal.addEventListener('abort', () => shutdown(session, 'aborted'), { once: true })

      resolve({
        url, token: tok, port: actualPort, expires,
        files: fileMeta.map((f) => ({ name: f.name, size: f.size, sha256: f.sha256 })),
        close: () => shutdown(session, 'manual'),
      })
    })
    server.on('error', reject)
  })
}
