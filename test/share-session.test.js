// test/share-session.test.js — 分享会话的生命周期契约(回归测试)。
// 背景:createShareSession 曾用 `resolve({url,token,port,expires,files,close})` 返回一个新建的
// 对象字面量,而 closed / downloaded / onDone / temps 只存在于内部 session 上。调用方写
// `session.onDone = fn` 落在了另一个对象上,shutdown() 永远读不到 → await onDone 永久挂起,
// 分享类工具调用后再也不返回。这组用例把该契约钉死。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createShareSession } from '../lib/share.js'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ls-share-'))
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }))
    }).on('error', reject)
  })
}

test('createShareSession: returns the session itself, not a copy', async () => {
  const dir = tmpdir()
  const f = path.join(dir, 'a.txt')
  fs.writeFileSync(f, 'AAA')
  const s = await createShareSession({ files: [f], expiresIn: 0 })
  try {
    // 旧实现返回的对象上这四个字段全是 undefined —— 回调因此失联。
    assert.equal(s.closed, false, 'closed 必须存在于返回对象上')
    assert.ok(s.downloaded instanceof Set, 'downloaded 必须存在于返回对象上')
    assert.equal(s.onDone, null, 'onDone 必须存在于返回对象上')
    assert.ok(Array.isArray(s.temps), 'temps 必须存在于返回对象上')
    assert.equal(typeof s.close, 'function')
    assert.match(s.url, /^http:\/\/[^/]+\/$/, 'url 应为根路径,多文件时才看得到列表页')
  } finally {
    s.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('createShareSession: onDone fires once all files are downloaded', async () => {
  const dir = tmpdir()
  const f = path.join(dir, 'a.txt')
  fs.writeFileSync(f, 'AAA')
  const s = await createShareSession({ files: [f], expiresIn: 0 })
  try {
    const done = new Promise((r) => { s.onDone = (reason) => r(reason) })
    const res = await get(`http://127.0.0.1:${s.port}/dl/${s.token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.toString(), 'AAA')
    assert.equal(await done, 'all files downloaded')
    assert.equal(s.downloaded.size, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('createShareSession: onDone fires on expiry', async () => {
  const dir = tmpdir()
  const f = path.join(dir, 'a.txt')
  fs.writeFileSync(f, 'AAA')
  const s = await createShareSession({ files: [f], expiresIn: 1 })
  try {
    const done = new Promise((r) => { s.onDone = (reason) => r(reason) })
    assert.equal(await done, 'expired')
    assert.equal(s.closed, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('createShareSession: close() fires onDone with "manual"', async () => {
  const dir = tmpdir()
  const f = path.join(dir, 'a.txt')
  fs.writeFileSync(f, 'AAA')
  const s = await createShareSession({ files: [f], expiresIn: 0 })
  try {
    const done = new Promise((r) => { s.onDone = (reason) => r(reason) })
    s.close()
    assert.equal(await done, 'manual')
    assert.equal(s.closed, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('createShareSession: session-owned temps survive until close, then are removed', async () => {
  const dir = tmpdir()
  const f = path.join(dir, 'a.txt')
  fs.writeFileSync(f, 'AAA')
  const tempZip = path.join(dir, 'packed.zip')
  fs.writeFileSync(tempZip, 'zip')
  const s = await createShareSession({ files: [f], expiresIn: 0, temps: [tempZip] })
  assert.ok(fs.existsSync(tempZip), '会话运行期间临时文件必须保留,否则链接取不到文件')
  s.close()
  assert.ok(!fs.existsSync(tempZip), '会话关闭后临时文件应被清理')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('createShareSession: root URL renders the multi-file list page', async () => {
  const dir = tmpdir()
  const a = path.join(dir, 'a.txt')
  const b = path.join(dir, 'b.txt')
  fs.writeFileSync(a, 'AAA')
  fs.writeFileSync(b, 'BBB')
  const s = await createShareSession({ files: [a, b], expiresIn: 0 })
  try {
    const res = await get(`http://127.0.0.1:${s.port}/`)
    assert.equal(res.status, 200)
    const html = res.body.toString()
    assert.ok(html.includes('a.txt') && html.includes('b.txt'), '列表页应列出全部文件')
    assert.ok(html.includes('?i=0') && html.includes('?i=1'), '每个文件都应有各自的下载入口')
  } finally {
    s.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
