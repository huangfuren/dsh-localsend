// lib/zip.js — 零依赖 ZIP 写入器(store/deflate + UTF-8 文件名)。仅用于目录打包。
// 不引入第三方压缩库,保持插件可离线、可审计。Windows/Linux/macOS 行为一致。
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

/**
 * 构建 zip 二进制。
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

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(METHOD_DEFLATE, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameLen, 26)
    local.writeUInt16LE(0, 28) // extra len
    locals.push(local, nameBuf, comp)
    offset += 30 + nameLen + comp.length

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(METHOD_DEFLATE, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameLen, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset - (30 + nameLen + comp.length), 42) // local header offset
    centrals.push(central, nameBuf)
  }

  const centralSize = centrals.reduce((a, b) => a + b.length, 0)
  const centralOffset = offset
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, ...centrals, eocd])
}
