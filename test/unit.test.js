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
