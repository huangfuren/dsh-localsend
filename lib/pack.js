// lib/pack.js — 目录收集与打包:把用户给的目录打成临时 zip,供发送链路使用。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { writeZipFile } from './zip.js'
import { fileNameOf } from './protocol.js'

/**
 * 递归收集目录内的普通文件清单(跳过符号链接与空目录),返回按名称排序的 {name, path, size}。
 * 只做 stat、**不读内容** —— 内容由 writeZipFile 逐个读取并立即释放,避免把整个目录攒进内存
 * (旧实现对每个文件 readFile 并把 data 留在数组里,峰值 ≈ 2 倍目录大小,大目录直接爆)。
 */
export async function collectDirectory(dir, { onSkip } = {}) {
  const files = []
  let total = 0
  const base = path.basename(dir)
  async function walk(abs, rel) {
    const dirents = await fs.promises.readdir(abs, { withFileTypes: true })
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const d of dirents) {
      if (d.isSymbolicLink()) {
        if (onSkip) onSkip(`skipped symlink: ${rel}/${d.name}`)
        continue
      }
      const relChild = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        await walk(path.join(abs, d.name), relChild)
      } else if (d.isFile()) {
        const full = path.join(abs, d.name)
        const st = await fs.promises.stat(full)
        files.push({ name: `${base}/${relChild}`, path: full, size: st.size })
        total += st.size
      }
    }
  }
  await walk(dir, '')
  return { files, total, base }
}

/**
 * 把目录打成临时 zip 文件(流式写入,峰值内存 ≈ 最大单文件)。
 * @returns {Promise<{zipPath:string, name:string, entryCount:number, size:number, totalUncompressed:number}>}
 */
export async function packDirectory(dir, { rootName, maxFileBytes, tmpDir = os.tmpdir(), onSkip } = {}) {
  const stat = await fs.promises.stat(dir)
  if (!stat.isDirectory()) throw new Error(`not a directory: ${dir}`)
  const { files, total, base } = await collectDirectory(dir, { onSkip })
  if (files.length === 0) throw new Error(`folder is empty (nothing to pack): ${dir}`)
  // 先按解压后总大小判上限,避免白写一遍盘才发现超限。
  if (maxFileBytes && total > maxFileBytes) {
    throw new Error(`packed folder exceeds maxFileBytes (${total} B > ${maxFileBytes} B)`)
  }
  const name = `${rootName || fileNameOf(base)}.zip`
  const zipPath = path.join(tmpDir, `${crypto.randomUUID()}-${name}`)
  const { size } = await writeZipFile(files.map((f) => ({ name: f.name, path: f.path })), zipPath)
  return { zipPath, name, entryCount: files.length, size, totalUncompressed: total }
}

/**
 * 解析"要发送的路径列表":文件原样发送,目录先打包成临时 zip。
 * @param {string[]} inputs 绝对路径(可含目录)
 * @returns {Promise<{targets:{sendPath:string,kind:'file'|'packed-dir',display:string}[], temps:string[], notes:string[]}>}
 */
export async function resolveSendTargets(inputs, { maxFileBytes, tmpDir, onSkip } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('no files or folders to send')
  const targets = []
  const temps = []
  const notes = []
  for (const raw of inputs) {
    const p = String(raw).trim()
    if (!p) continue
    const st = await fs.promises.stat(p).catch(() => null)
    if (!st) throw new Error(`path not found: ${p}`)
    if (st.isFile()) {
      if (maxFileBytes && st.size > maxFileBytes) throw new Error(`file too large (${st.size} B > limit ${maxFileBytes} B): ${p}`)
      targets.push({ sendPath: p, kind: 'file', display: path.basename(p) })
    } else if (st.isDirectory()) {
      const packed = await packDirectory(p, { maxFileBytes, tmpDir, onSkip })
      temps.push(packed.zipPath)
      targets.push({ sendPath: packed.zipPath, kind: 'packed-dir', display: packed.name })
      notes.push(`packed "${p}" -> ${packed.name} (${packed.entryCount} file(s), ${packed.size} B)`)
    } else {
      throw new Error(`unsupported path (not a file or folder): ${p}`)
    }
  }
  if (targets.length === 0) throw new Error('no sendable files or folders in the given list')
  return { targets, temps, notes }
}

/** 尽力删除临时 zip。 */
export async function cleanupTemps(temps) {
  for (const t of temps || []) {
    try { await fs.promises.unlink(t) } catch { /* 忽略 */ }
  }
}
