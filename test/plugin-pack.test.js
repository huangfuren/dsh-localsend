// test/plugin-pack.test.js — 插件打包核心:排除规则/清单/安装卡/zip 往返 + HTTP e2e。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { buildManifest, collectPluginFiles, packPlugin, readPluginMeta, resolvePluginDir } from '../lib/plugin-pack.js'
import { createShareSession } from '../lib/share.js'
import { crc32 } from '../lib/zip.js'

/** 极简 zip 解析(与 test/zip.test.js 同款,独立可读)。 */
function parseZip(buf) {
  const eocdOff = buf.length - 22
  assert.equal(buf.readUInt32LE(eocdOff), 0x06054b50, 'EOCD signature')
  const count = buf.readUInt16LE(eocdOff + 10)
  const cdOff = buf.readUInt32LE(eocdOff + 16)
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
  for (const e of entries) {
    const l = e.localOff
    const method = buf.readUInt16LE(l + 8)
    const nameLen = buf.readUInt16LE(l + 26)
    const extraLen = buf.readUInt16LE(l + 28)
    const dataStart = l + 30 + nameLen + extraLen
    const comp = buf.subarray(dataStart, dataStart + e.compSize)
    e.raw = method === 8 ? zlib.inflateRawSync(comp) : comp
    assert.equal(crc32(e.raw), e.crc)
  }
  return { count, entries }
}

/** 造一个最小 DSH 插件目录。 */
function makePluginDir(root, { name = 'dsh-demo', withNodeModules = true } = {}) {
  const dir = path.join(root, name)
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name, version: '1.2.3', description: 'demo plugin',
    engines: { dsh: '>=0.1.1-rc.2 <0.2.0', node: '>=22.19' },
  }, null, 2))
  fs.writeFileSync(path.join(dir, 'dsh.plugin.json'), JSON.stringify({
    id: `dsh-external/${name}`, version: '1.2.3', main: './lib/index.js',
    contributes: { tools: ['demo_ping'], skills: [] },
  }))
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export default {}\n')
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n')
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  if (withNodeModules) {
    fs.mkdirSync(path.join(dir, 'node_modules', 'some-dep'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'some-dep', 'index.js'), 'module.exports=1\n')
  }
  fs.writeFileSync(path.join(dir, '.DS_Store'), 'junk')
  fs.writeFileSync(path.join(dir, 'debug.log'), 'noise')
  return dir
}

test('collectPluginFiles excludes node_modules/.git/junk but keeps sources', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-pack-'))
  try {
    const dir = makePluginDir(root)
    const skipped = []
    const files = await collectPluginFiles(dir, { onSkip: (n) => skipped.push(n) })
    const names = files.map((f) => f.name)
    assert.ok(names.includes('package.json'))
    assert.ok(names.includes('lib/index.js'))
    assert.ok(names.includes('README.md'))
    assert.ok(!names.some((n) => n.startsWith('node_modules')))
    assert.ok(!names.some((n) => n.startsWith('.git')))
    assert.ok(!names.includes('.DS_Store'))
    assert.ok(!names.includes('debug.log'))
    assert.ok(skipped.some((n) => n === 'node_modules'))
    assert.ok(skipped.some((n) => n === '.git'))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('readPluginMeta extracts name/version/minDsh/pluginId/tools', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-pack-'))
  try {
    const meta = await readPluginMeta(makePluginDir(root))
    assert.equal(meta.name, 'dsh-demo')
    assert.equal(meta.version, '1.2.3')
    assert.equal(meta.minDsh, '>=0.1.1-rc.2 <0.2.0')
    assert.equal(meta.pluginId, 'dsh-external/dsh-demo')
    assert.deepEqual(meta.tools, ['demo_ping'])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('readPluginMeta rejects a non-plugin dir', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-pack-'))
  try {
    await assert.rejects(() => readPluginMeta(root), /package.json missing/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('buildManifest lists every file with sha256 and an install template', () => {
  const meta = { name: 'dsh-demo', version: '1.2.3', minDsh: '>=0.1.0', pluginId: 'x', tools: [], description: '' }
  const files = [{ name: 'lib/index.js', data: Buffer.from('export default {}') }]
  const m = buildManifest(meta, files, { installDirTemplate: '<解压目录>/dsh-demo' })
  assert.equal(m.format, 'dsh-plugin-package')
  assert.equal(m.formatVersion, 1)
  assert.equal(m.files[0].name, 'lib/index.js')
  assert.equal(m.files[0].size, files[0].data.length)
  assert.match(m.files[0].sha256, /^[0-9a-f]{64}$/)
  assert.match(m.install.command, /dsh plugin --profile web add link:/)
})

test('packPlugin produces a zip containing manifest + INSTALL.md + sources under <name>/', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-pack-'))
  try {
    const out = await packPlugin(makePluginDir(root))
    try {
      assert.equal(out.meta.name, 'dsh-demo')
      assert.equal(out.fileName, 'dsh-demo-1.2.3.dsh-plugin.zip')
      assert.ok(fs.existsSync(out.zipPath))
      const buf = fs.readFileSync(out.zipPath)
      const z = parseZip(buf)
      const names = z.entries.map((e) => e.name)
      assert.ok(names.includes('dsh-demo/dsh-plugin.manifest.json'))
      assert.ok(names.includes('dsh-demo/INSTALL.md'))
      assert.ok(names.includes('dsh-demo/lib/index.js'))
      assert.ok(!names.some((n) => n.includes('node_modules')))
      const installMd = z.entries.find((e) => e.name === 'dsh-demo/INSTALL.md').raw.toString('utf8')
      assert.match(installMd, /dsh plugin --profile web add link:/)
      assert.match(installMd, /pnpm install/)
    } finally { fs.rmSync(out.zipPath, { force: true }) }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('e2e: plugin pack downloads over the share link and parses as a zip', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-pack-e2e-'))
  try {
    const packed = await packPlugin(makePluginDir(root, { withNodeModules: true }))
    try {
      const session = await createShareSession({
        files: [packed.zipPath],
        alias: 'pack-e2e',
        password: '',
        expiresIn: 30,
        port: 0,
      })
      const res = await fetch(session.url)
      assert.equal(res.status, 200)
      const buf = Buffer.from(await res.arrayBuffer())
      assert.equal(buf.readUInt32LE(0), 0x04034b50, 'downloaded bytes are a zip')
      const z = parseZip(buf)
      const names = z.entries.map((e) => e.name)
      assert.ok(names.includes('dsh-demo/dsh-plugin.manifest.json'))
      assert.ok(names.includes('dsh-demo/lib/index.js'))
      // 下载完成后服务器应自动关闭 → 再请求应失败。
      await new Promise((r) => setTimeout(r, 700))
      await assert.rejects(() => fetch(session.url))
    } finally { fs.rmSync(packed.zipPath, { force: true }) }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('resolvePluginDir accepts a directory path and rejects unknown names', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-pack-'))
  try {
    const dir = makePluginDir(root)
    assert.equal(await resolvePluginDir(dir), path.resolve(dir))
    // profile 下按名解析:构造 web profile 的 node_modules 布局。
    const nm = path.join(root, 'profiles', 'web', 'node_modules', 'dsh-demo')
    fs.mkdirSync(nm, { recursive: true })
    fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '0.0.1' }))
    assert.equal(await resolvePluginDir('dsh-demo', { dshProfileDir: root }), nm)
    await assert.rejects(() => resolvePluginDir('missing-plugin', { dshProfileDir: root }), /plugin not found/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
