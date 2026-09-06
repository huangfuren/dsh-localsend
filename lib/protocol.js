// lib/protocol.js — LocalSend v2 上传协议的发送端实现(纯函数 + 请求封装)。零依赖。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DEFAULT_PROTOCOL, DEVICE_MODEL, DEVICE_TYPE, PROTOCOL_VERSION, SENDER_PORT, SENDER_PROTOCOL, errorText,
} from './constants.js'
import { request } from './net.js'

const MIME = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.text': 'text/plain',
  '.pdf': 'application/pdf', '.json': 'application/json', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.ts': 'text/typescript',
  '.css': 'text/css', '.html': 'text/html', '.xml': 'text/xml',
  '.csv': 'text/csv', '.yml': 'text/yaml', '.yaml': 'text/yaml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.exe': 'application/octet-stream', '.msi': 'application/octet-stream',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.mov': 'video/quicktime',
}

export function uuid() {
  return crypto.randomUUID()
}

export function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export function mimeOf(name) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return MIME[ext] || 'application/octet-stream'
}

export function fileNameOf(filePath) {
  const n = path.basename(filePath)
  return n.replace(/[\\/:*?"<>|]/g, '_')
}

/** 发送方信息(info 字段),HTTPS 模式下 fingerprint 仅用于防自我发现,可随机。 */
export function buildSenderInfo(alias) {
  return {
    alias: alias || osAlias(),
    version: PROTOCOL_VERSION,
    deviceModel: DEVICE_MODEL,
    deviceType: DEVICE_TYPE,
    fingerprint: crypto.randomBytes(16).toString('hex'),
    port: SENDER_PORT,
    protocol: SENDER_PROTOCOL,
    download: false,
  }
}

function osAlias() {
  try { return os.hostname() || 'dsh-localsend' } catch { return 'dsh-localsend' }
}

/** 由一组文件(绝对路径)构建 files 元信息,返回 { entries, buffers }。 */
export async function buildFileEntries(filePaths, { maxFileBytes } = {}) {
  const entries = {}
  const buffers = {}
  for (const fp of filePaths) {
    const stat = await fs.promises.stat(fp)
    if (!stat.isFile()) throw new Error(`not a regular file: ${fp}`)
    if (maxFileBytes && stat.size > maxFileBytes) {
      throw new Error(`file too large (${stat.size} B > limit ${maxFileBytes} B): ${fp}`)
    }
    const data = await fs.promises.readFile(fp)
    const id = uuid()
    const name = fileNameOf(fp)
    buffers[id] = data
    entries[id] = {
      id,
      fileName: name,
      size: data.length,
      fileType: mimeOf(name),
      sha256: sha256hex(data),
      preview: null,
      metadata: { modified: stat.mtime.toISOString() },
    }
  }
  return { entries, buffers }
}

/** POST /api/localsend/v2/prepare-upload,返回 {sessionId, tokens}。会阻塞到接收端决定或超时。 */
export async function prepareUpload(ip, port, senderInfo, entries, { protocol = DEFAULT_PROTOCOL, timeoutMs = 240_000, signal } = {}) {
  const body = JSON.stringify({ info: senderInfo, files: entries })
  const r = await request({
    protocol, host: ip, port, method: 'POST', path: '/api/localsend/v2/prepare-upload',
    headers: { 'Content-Type': 'application/json' }, body, timeoutMs, signal,
  })
  if (r.status === 204) return { noTransfer: true }
  if (r.status !== 200) throw new Error(`prepare-upload ${errorText(r.status)}${r.text ? `: ${r.text.slice(0, 200)}` : ''}`)
  let json
  try { json = JSON.parse(r.text) } catch { throw new Error(`prepare-upload returned unparseable JSON: ${r.text.slice(0, 200)}`) }
  const tokens = {}
  if (json.files && typeof json.files === 'object') {
    for (const [fid, tok] of Object.entries(json.files)) tokens[fid] = typeof tok === 'string' ? tok : ''
  }
  return { sessionId: json.sessionId, tokens }
}

/** POST /api/localsend/v2/upload,body=原始字节。token 可选(兼容协议 2.0/2.1)。 */
export async function uploadFile(ip, port, { sessionId, fileId, token = '' }, buffer, { protocol = DEFAULT_PROTOCOL, timeoutMs = 120_000, signal } = {}) {
  let q = `sessionId=${encodeURIComponent(sessionId)}&fileId=${encodeURIComponent(fileId)}`
  if (token) q += `&token=${encodeURIComponent(token)}`
  const r = await request({
    protocol, host: ip, port, method: 'POST', path: `/api/localsend/v2/upload?${q}`,
    headers: { 'Content-Type': 'application/octet-stream' }, body: buffer, timeoutMs, signal,
  })
  return r
}

/** POST /api/localsend/v2/cancel(尽力而为,失败静默)。 */
export async function cancelSession(ip, port, sessionId, { protocol = DEFAULT_PROTOCOL, timeoutMs = 10_000, signal } = {}) {
  try {
    await request({
      protocol, host: ip, port, method: 'POST', path: `/api/localsend/v2/cancel?sessionId=${encodeURIComponent(sessionId)}`,
      timeoutMs, signal,
    })
  } catch { /* cancel 失败不影响主流程 */ }
}
