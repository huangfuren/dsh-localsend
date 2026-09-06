// test/zip.test.js — zip 写入器与目录打包的单元测试(不依赖网络)。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { cleanupTemps, packDirectory, resolveSendTargets } from '../lib/pack.js'
import { crc32, createZip } from '../lib/zip.js'

/** 简易 zip 解析:返回中央目录条目 [{name, method, crc, compSize, uncompSize, offset}]。 */
function parseZip(buf) {
  assert.ok(buf.length >= 22)
  const eocdOff = buf.length - 22
  assert.equal(buf.readUInt32LE(eocdOff), 0x06054b50, 'EOCD signature')
  const count = buf.readUInt16LE(eocdOff + 10)
  const cdSize = buf.readUInt32LE(eocdOff + 12)
  const cdOff = buf.readUInt32LE(eocdOff + 16)
  assert.equal(buf.readUInt16LE(eocdOff + 8), count, 'same entry count on both EOCD fields')
  const entries = []
  let p = cdOff
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central signature')
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    entries.push({ name, localOff, crc: buf.readUInt32LE(p + 16), compSize: buf.readUInt32LE(p + 20), uncompSize: buf.readUInt32LE(p + 24) })
    p += 46 + nameLen + extraLen + commentLen
  }
  assert.equal(p - cdOff, cdSize, 'central directory size matches')
  // 读出每个本地条目的内容
  for (const e of entries) {
    const l = e.localOff
    assert.equal(buf.readUInt32LE(l), 0x04034b50, 'local signature')
    const method = buf.readUInt16LE(l + 8)
    const nameLen = buf.readUInt16LE(l + 26)
    const extraLen = buf.readUInt16LE(l + 28)
    const dataStart = l + 30 + nameLen + extraLen
    const comp = buf.subarray(dataStart, dataStart + e.compSize)
    e.raw = method === 8 ? zlib.inflateRawSync(comp) : comp
    assert.equal(e.raw.length, e.uncompSize)
    assert.equal(crc32(e.raw), e.crc)
  }
  return { count, entries }
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('createZip round-trips entries incl unicode names', () => {
  const buf = createZip([
    { name: 'hello.txt', data: Buffer.from('hello zip') },
    { name: 'sub/中文.md', data: Buffer.from('# t\ncontent') },
  ])
  const z = parseZip(buf)
  assert.equal(z.count, 2)
  const names = z.entries.map((e) => e.name)
  assert.ok(names.includes('hello.txt'))
  assert.ok(names.includes('sub/中文.md'))
  assert.equal(z.entries.find((e) => e.name === 'hello.txt').raw.toString(), 'hello zip')
  // 每个 local header 都应带 UTF-8 标志(bit 11)。
  for (const e of z.entries) {
    assert.ok(buf.readUInt16LE(e.localOff + 6) & 0x0800)
  }
})

test('packDirectory + resolveSendTargets pack a folder tree and clean up', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-zip-'))
  const dir = path.join(root, '素材')
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a.txt'), 'A'.repeat(500))
  fs.writeFileSync(path.join(dir, 'nested', 'b.md'), '# B')
  fs.writeFileSync(path.join(root, 'loose.txt'), 'loose')
  try {
    const { targets, temps, notes } = await resolveSendTargets([dir, path.join(root, 'loose.txt')], { maxFileBytes: 10 * 1024 * 1024 })
    assert.equal(temps.length, 1)
    assert.ok(notes.some((n) => n.includes('素材.zip')))
    assert.equal(targets.length, 2)
    const packed = targets.find((t) => t.kind === 'packed-dir')
    const plain = targets.find((t) => t.kind === 'file')
    assert.ok(packed && packed.display === '素材.zip')
    assert.ok(plain && plain.display === 'loose.txt')
    const zipBuf = fs.readFileSync(packed.sendPath)
    assert.equal(zipBuf.readUInt32LE(0), 0x04034b50, 'zip local header magic')
    const z = parseZip(zipBuf)
    assert.equal(z.count, 2)
    assert.ok(z.entries.some((e) => e.name === '素材/a.txt'))
    assert.ok(z.entries.some((e) => e.name === '素材/nested/b.md'))
    await cleanupTemps(temps)
    assert.ok(!fs.existsSync(packed.sendPath), 'temp zip removed')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveSendTargets rejects nonexistent paths and empty folders', async () => {
  await assert.rejects(() => resolveSendTargets(['Z:/definitely/not/here'], {}), /path not found/)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-zip-'))
  fs.mkdirSync(path.join(root, 'empty'), { recursive: true })
  try {
    await assert.rejects(() => resolveSendTargets([path.join(root, 'empty')], {}), /empty/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
