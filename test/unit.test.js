// test/unit.test.js — 纯函数单测(不依赖网络与 dsh-tools)。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { computeSubnet, parseCidr } from '../lib/discovery.js'
import {
  buildFileEntries, buildSenderInfo, fileNameOf, mimeOf, sha256hex, uuid,
} from '../lib/protocol.js'
import { errorText } from '../lib/constants.js'
import { resolveShareOptions } from '../lib/share.js'

test('sha256hex matches known digest', () => {
  assert.equal(sha256hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('uuid unique & parseable', () => {
  assert.notEqual(uuid(), uuid())
  assert.match(uuid(), /^[0-9a-f-]{36}$/)
})

test('mimeOf maps known and falls back', () => {
  assert.equal(mimeOf('a.md'), 'text/markdown')
  assert.equal(mimeOf('b.PDF'), 'application/pdf')
  assert.equal(mimeOf('c.unknownext'), 'application/octet-stream')
})

test('fileNameOf strips illegal characters', () => {
  // 用平台自己的分隔符拼路径。此前这里写死了 Windows 路径 'C:\\x\\y\\a:b?.txt'，
  // 在 POSIX 上 path.basename 不把反斜杠当分隔符 —— 整串被留下，断言随之失败。
  // 实现是对的（Linux 文件名里 \ 是合法字符，不该被当成分隔符），所以修的是用例：
  // 第一次跑三平台 CI 就把这个只在 Windows 上成立的假设暴露了出来。
  assert.equal(fileNameOf(['x', 'y', 'a:b?.txt'].join(path.sep)), 'a_b_.txt')
  assert.equal(fileNameOf(['', 'tmp', 'ok.txt'].join(path.sep)), 'ok.txt')
})

test('errorText maps statuses', () => {
  assert.equal(errorText(403), 'rejected by receiver')
  assert.equal(errorText(422), 'checksum mismatch (sha256)')
  assert.equal(errorText(418), 'HTTP 418')
})

test('computeSubnet derives /24 base', () => {
  const s = computeSubnet('192.168.1.66', '255.255.255.0')
  assert.equal(s.networkBase, '192.168.1.0')
  assert.equal(s.prefix, 24)
  assert.equal(s.selfIp, '192.168.1.66')
})

test('parseCidr accepts /24 and rejects bad input', () => {
  const s = parseCidr('10.0.0.5/24')
  assert.equal(s.networkBase, '10.0.0.0')
  assert.equal(s.prefix, 24)
  assert.throws(() => parseCidr('bogus'), /invalid CIDR/)
  assert.throws(() => parseCidr('10.0.0.5/8'), /range/)
})

test('buildSenderInfo shape', () => {
  const info = buildSenderInfo('tester')
  assert.equal(info.alias, 'tester')
  assert.equal(info.protocol, 'https')
  assert.equal(typeof info.fingerprint, 'string')
})

test('buildFileEntries computes size and sha256', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-unit-'))
  const p = path.join(dir, 'hello.txt')
  fs.writeFileSync(p, Buffer.from('hello world'))
  try {
    const { entries, buffers } = await buildFileEntries([p])
    const ids = Object.keys(entries)
    assert.equal(ids.length, 1)
    const e = entries[ids[0]]
    assert.equal(e.size, 11)
    assert.equal(e.sha256, sha256hex(buffers[ids[0]]))
    assert.equal(e.fileName, 'hello.txt')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── 分享参数解析：显式参数 > 设置项（shareExpiresIn / sharePort / sharePassword）> 内置默认 ──
test('resolveShareOptions falls back to built-in defaults when nothing is given', () => {
  assert.deepEqual(resolveShareOptions({}, {}), { password: '', expiresIn: 3600, port: 0 })
  assert.deepEqual(resolveShareOptions(), { password: '', expiresIn: 3600, port: 0 })
})

// 回归：旧实现写 `Number(x) || 3600`，把显式传入的 0（README 与工具描述都声明为「无有效期」）
// 当成假值吞成了 3600；端口同理。0 必须原样保留。
test('resolveShareOptions keeps an explicit 0 (no expiry / random port)', () => {
  const r = resolveShareOptions({ expiresIn: 0, port: 0 }, { shareExpiresIn: 600, sharePort: 8080 })
  assert.equal(r.expiresIn, 0)
  assert.equal(r.port, 0)
})

test('resolveShareOptions falls back to settings when args omit the field', () => {
  const r = resolveShareOptions({}, { shareExpiresIn: 600, sharePort: 8080, sharePassword: 'pw' })
  assert.deepEqual(r, { password: 'pw', expiresIn: 600, port: 8080 })
})

test('resolveShareOptions: explicit args win; empty password overrides to none', () => {
  const cfg = { shareExpiresIn: 600, sharePort: 8080, sharePassword: 'pw' }
  assert.deepEqual(
    resolveShareOptions({ expiresIn: 120, port: 9000, password: 'x' }, cfg),
    { password: 'x', expiresIn: 120, port: 9000 },
  )
  assert.equal(resolveShareOptions({ password: '' }, cfg).password, '')
})

test('resolveShareOptions clamps invalid input instead of propagating it', () => {
  assert.equal(resolveShareOptions({ expiresIn: 'abc' }, {}).expiresIn, 3600)
  assert.equal(resolveShareOptions({ expiresIn: -5 }, {}).expiresIn, 0)
  assert.equal(resolveShareOptions({ port: 3000.7 }, {}).port, 3000)
  assert.equal(resolveShareOptions({ port: -1 }, {}).port, 0)
})
