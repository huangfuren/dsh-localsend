// lib/zip.js — 零依赖 ZIP 写入器(store/deflate + UTF-8 文件名)。仅用于目录打包。
// 不引入第三方压缩库,保持插件可离线、可审计。Windows/Linux/macOS 行为一致。
import fs from 'node:fs'
import zlib from 'node:zlib'

// ---- CRC-32(IEEE) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
// general purpose bit 11 = UTF-8 文件名(避免中文名在部分解压器按 CP437 乱码)。
const FLAG_UTF8 = 0x0800
const METHOD_DEFLATE = 8

function dosDateTime() {
  const d = new Date()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** 本地文件头(30 字节定长部分)。 */
function localHeader({ time, date, crc, compSize, uncompSize, nameLen }) {
  const b = Buffer.alloc(30)
  b.writeUInt32LE(SIG_LOCAL, 0)
  b.writeUInt16LE(20, 4) // version needed
  b.writeUInt16LE(FLAG_UTF8, 6)
  b.writeUInt16LE(METHOD_DEFLATE, 8)
  b.writeUInt16LE(time, 10)
  b.writeUInt16LE(date, 12)
  b.writeUInt32LE(crc, 14)
  b.writeUInt32LE(compSize, 18)
  b.writeUInt32LE(uncompSize, 22)
  b.writeUInt16LE(nameLen, 26)
  b.writeUInt16LE(0, 28) // extra len
  return b
}

/** 中央目录项(46 字节定长部分)。 */
function centralHeader({ time, date, crc, compSize, uncompSize, nameLen, localOffset }) {
  const b = Buffer.alloc(46)
  b.writeUInt32LE(SIG_CENTRAL, 0)
  b.writeUInt16LE(20, 4) // version made by
  b.writeUInt16LE(20, 6) // version needed
  b.writeUInt16LE(FLAG_UTF8, 8)
  b.writeUInt16LE(METHOD_DEFLATE, 10)
  b.writeUInt16LE(time, 12)
  b.writeUInt16LE(date, 14)
  b.writeUInt32LE(crc, 16)
  b.writeUInt32LE(compSize, 20)
  b.writeUInt32LE(uncompSize, 24)
  b.writeUInt16LE(nameLen, 28)
  b.writeUInt16LE(0, 30) // extra
  b.writeUInt16LE(0, 32) // comment
  b.writeUInt16LE(0, 34) // disk
  b.writeUInt16LE(0, 36) // internal attrs
  b.writeUInt32LE(0, 38) // external attrs
  b.writeUInt32LE(localOffset, 42)
  return b
}

/** EOCD 记录(22 字节,无注释)。 */
function eocdRecord({ count, centralSize, centralOffset }) {
  const b = Buffer.alloc(22)
  b.writeUInt32LE(SIG_EOCD, 0)
  b.writeUInt16LE(0, 4)
  b.writeUInt16LE(0, 6)
  b.writeUInt16LE(count, 8)
  b.writeUInt16LE(count, 10)
  b.writeUInt32LE(centralSize, 12)
  b.writeUInt32LE(centralOffset, 16)
  b.writeUInt16LE(0, 20)
  return b
}

/**
 * 构建 zip 二进制(**全内存**)。
 * 只适合小体量输入(如插件包);目录打包请走 writeZipFile —— 它不会把整个目录攒进内存。
 * @param {{name:string, data:Buffer}[]} entries 条目名用 '/' 分隔,不含前导 '/';条目按给定顺序写入。
 * @returns {Buffer}
 */
export function createZip(entries) {
  const { time, date } = dosDateTime()
  const locals = []
  const centrals = []
  let offset = 0
  const enc = (s) => Buffer.from(s, 'utf8')

  for (const e of entries) {
    const nameBuf = enc(e.name)
    const data = e.data
    const crc = crc32(data)
    const comp = zlib.deflateRawSync(data)
    const nameLen = nameBuf.length

    locals.push(
      localHeader({ time, date, crc, compSize: comp.length, uncompSize: data.length, nameLen }),
      nameBuf, comp,
    )
    centrals.push(
      centralHeader({ time, date, crc, compSize: comp.length, uncompSize: data.length, nameLen, localOffset: offset }),
      nameBuf,
    )
    offset += 30 + nameLen + comp.length
  }

  const centralSize = centrals.reduce((a, b) => a + b.length, 0)
  return Buffer.concat([
    ...locals, ...centrals,
    eocdRecord({ count: entries.length, centralSize, centralOffset: offset }),
  ])
}

/**
 * 流式把磁盘文件写入 zip:逐个「读入 → 压缩 → 写盘」,写完即释放。
 * 峰值内存 ≈ **最大单文件**,而不是目录总和 —— 目录大于可用内存时 createZip 会直接爆掉。
 * @param {{name:string, path:string}[]} entries 条目名用 '/' 分隔;按给定顺序写入。
 * @param {string} outPath 目标 zip 路径
 * @returns {Promise<{size:number, entryCount:number}>}
 */
export async function writeZipFile(entries, outPath) {
  const { time, date } = dosDateTime()
  const enc = (s) => Buffer.from(s, 'utf8')
  const centrals = []
  let offset = 0
  let fh = null

  try {
    // 用 FileHandle 顺序写:比 WriteStream 少一层异步 open/close 的尾巴 —— 后者在「首文件读取
    // 即失败」时,open 仍会在测试结束后落地并抛 ENOENT(实测触发 uncaughtException)。
    fh = await fs.promises.open(outPath, 'w')
    const put = (buf) => fh.write(buf)

    for (const e of entries) {
      const nameBuf = enc(e.name)
      const data = await fs.promises.readFile(e.path)
      const crc = crc32(data)
      const comp = zlib.deflateRawSync(data)
      const nameLen = nameBuf.length

      await put(localHeader({ time, date, crc, compSize: comp.length, uncompSize: data.length, nameLen }))
      await put(nameBuf)
      await put(comp)

      centrals.push(
        centralHeader({ time, date, crc, compSize: comp.length, uncompSize: data.length, nameLen, localOffset: offset }),
        nameBuf,
      )
      offset += 30 + nameLen + comp.length
    }

    let centralSize = 0
    for (const b of centrals) {
      await put(b)
      centralSize += b.length
    }
    await put(eocdRecord({ count: entries.length, centralSize, centralOffset: offset }))
    await fh.close()
    fh = null
  } catch (err) {
    if (fh) await fh.close().catch(() => { /* 忽略 */ })
    await fs.promises.rm(outPath, { force: true }).catch(() => { /* 忽略 */ })
    throw err
  }

  const st = await fs.promises.stat(outPath)
  return { size: st.size, entryCount: entries.length }
}
