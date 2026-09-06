// lib/transfer.js — 发送编排:校验文件 → 读入+哈希 → prepare(等待接收端接受) → upload。
import { cancelSession, buildFileEntries, buildSenderInfo, prepareUpload, uploadFile } from './protocol.js'
import { errorText } from './constants.js'

/**
 * @param {object} o
 * @param {string} o.ip 目标 IP
 * @param {number} o.port
 * @param {string} o.alias 发送方别名
 * @param {string[]} o.files 文件绝对路径
 * @param {string} [o.protocol]
 * @param {number} [o.maxFileBytes]
 * @param {number} [o.prepareTimeoutMs]
 * @param {number} [o.uploadTimeoutMs]
 * @param {(line:string)=>void} [o.onLog]
 * @param {AbortSignal} [o.signal]
 */
export async function sendFiles({
  ip, port, alias, files, protocol, maxFileBytes, prepareTimeoutMs, uploadTimeoutMs, onLog, signal,
}) {
  const log = (s) => onLog && onLog(s)
  if (!Array.isArray(files) || files.length === 0) throw new Error('no files to send')
  const resolved = files.map((f) => String(f).trim()).filter(Boolean)
  if (resolved.length === 0) throw new Error('no files to send (empty list)')
  if (resolved.length !== files.length) log(`note: skipped ${files.length - resolved.length} empty path(s)`)

  log(`reading ${resolved.length} file(s) and computing sha256 ...`)
  const { entries, buffers } = await buildFileEntries(resolved, { maxFileBytes })
  const senderInfo = buildSenderInfo(alias)

  log(`prepare-upload -> ${ip}:${port} (${resolved.length} file(s), waiting for the receiver to accept...)`)
  const prep = await prepareUpload(ip, port, senderInfo, entries, { protocol, timeoutMs: prepareTimeoutMs, signal })
  if (prep.noTransfer) {
    log('receiver replied 204 (no transfer needed); nothing sent')
    return { sessionId: null, results: [] }
  }
  const { sessionId, tokens } = prep
  log(`session accepted: ${sessionId}`)

  const results = []
  try {
    for (const [fid, meta] of Object.entries(entries)) {
      const token = (tokens && tokens[fid]) || ''
      log(`uploading "${meta.fileName}" (${meta.size} B) ...`)
      const up = await uploadFile(ip, port, { sessionId, fileId: fid, token }, buffers[fid], {
        protocol, timeoutMs: uploadTimeoutMs, signal,
      })
      if (up.status !== 200) {
        throw new Error(`upload "${meta.fileName}" failed: ${errorText(up.status)}${up.text ? `: ${up.text.slice(0, 200)}` : ''}`)
      }
      results.push({ fileName: meta.fileName, bytes: meta.size, status: 'ok' })
      log(`OK "${meta.fileName}" (HTTP 200)`)
    }
    return { sessionId, results }
  } catch (err) {
    // 失败时尽力取消会话,避免接收端残留悬挂对话框。
    await cancelSession(ip, port, sessionId, { protocol, signal })
    throw err
  }
}
