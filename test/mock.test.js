// test/mock.test.js — 本地 mock 接收端端到端:prepare/upload(成功)/sha256 422/cancel。
// 用纯 http + 临时端口,不依赖真实网络;覆盖 lib/net、lib/protocol、lib/transfer。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { cancelSession, prepareUpload, sha256hex, uploadFile } from '../lib/protocol.js'
import { cleanupTemps, resolveSendTargets } from '../lib/pack.js'
import { sendFiles } from '../lib/transfer.js'

/** 极简 mock 接收端:记录每个会话的元信息,upload 校验 sha256。 */
function startMock() {
  const store = new Map() // sessionId -> { entries }
  const uploads = {} // fileId -> { fileName, buffer }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(body === undefined ? '' : JSON.stringify(body))
    }
    if (u.pathname === '/api/localsend/v2/info' && req.method === 'GET') {
      return send(200, { alias: 'Mock-Device', version: '2.1' })
    }
    if (u.pathname === '/api/localsend/v2/prepare-upload' && req.method === 'POST') {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        const parsed = JSON.parse(b)
        const sessionId = 'mock-session'
        store.set(sessionId, parsed.files || {})
        const tokens = {}
        for (const id of Object.keys(parsed.files || {})) tokens[id] = `token-${id}`
        send(200, { sessionId, files: tokens })
      })
      return
    }
    if (u.pathname === '/api/localsend/v2/upload' && req.method === 'POST') {
      const sessionId = u.searchParams.get('sessionId')
      const fileId = u.searchParams.get('fileId')
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const data = Buffer.concat(chunks)
        const meta = store.get(sessionId)?.[fileId]
        if (!meta) return send(500, { error: 'unknown file' })
        if (data.length !== meta.size) return send(422, { error: 'size mismatch' })
        if (meta.sha256 && sha256hex(data) !== meta.sha256) return send(422, { error: 'sha256 mismatch' })
        uploads[fileId] = { fileName: meta.fileName, buffer: data }
        send(200, {})
      })
      return
    }
    if (u.pathname === '/api/localsend/v2/cancel' && req.method === 'POST') {
      return send(200, {})
    }
    send(404, { error: 'not found' })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, uploads }))
  })
}

test('end-to-end: sendFiles over mock receiver succeeds', async () => {
  const { server, port } = await startMock()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-e2e-'))
  const f1 = path.join(dir, 'a.txt')
  const f2 = path.join(dir, 'b.md')
  fs.writeFileSync(f1, 'payload one')
  fs.writeFileSync(f2, '# title\nbody')
  try {
    const logs = []
    const out = await sendFiles({
      ip: '127.0.0.1', port, alias: 'unit-tester', files: [f1, f2],
      protocol: 'http', maxFileBytes: 1024 * 1024,
      prepareTimeoutMs: 5000, uploadTimeoutMs: 5000, onLog: (l) => logs.push(l),
    })
    assert.ok(out.sessionId)
    assert.equal(out.results.length, 2)
    assert.ok(out.results.every((r) => r.status === 'ok'))
    assert.ok(logs.some((l) => l.includes('OK "a.txt"')))
    assert.ok(logs.some((l) => l.includes('OK "b.md"')))
  } finally {
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('sha256 mismatch yields HTTP 422 and error text', async () => {
  const { server, port } = await startMock()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-e2e-'))
  const f = path.join(dir, 'x.bin')
  fs.writeFileSync(f, Buffer.from('correct bytes'))
  try {
    const { entries, buffers } = await import('../lib/protocol.js').then((m) => m.buildFileEntries([f]))
    const id = Object.keys(entries)[0]
    const sender = { alias: 't', version: '2.1', protocol: 'http' }
    const prep = await prepareUpload('127.0.0.1', port, sender, entries, { protocol: 'http', timeoutMs: 5000 })
    const tampered = Buffer.from('wrong bytes!!')
    const up = await uploadFile('127.0.0.1', port, { sessionId: prep.sessionId, fileId: id, token: '' }, tampered, { protocol: 'http', timeoutMs: 5000 })
    assert.equal(up.status, 422)
    assert.match(up.text, /sha256|size/i)
  } finally {
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('cancelSession does not throw on mock', async () => {
  const { server, port } = await startMock()
  try {
    await cancelSession('127.0.0.1', port, 'whatever', { protocol: 'http' })
  } finally {
    server.close()
  }
})

test('end-to-end: folder is auto-packed to zip and uploaded', async () => {
  const { server, port, uploads } = await startMock()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-e2e-folder-'))
  const folder = path.join(dir, '资料')
  fs.mkdirSync(path.join(folder, '子'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'main.txt'), 'folder payload')
  fs.writeFileSync(path.join(folder, '子', 'note.md'), '# note')
  try {
    const { targets, temps } = await resolveSendTargets([folder], { maxFileBytes: 5 * 1024 * 1024 })
    assert.equal(targets.length, 1)
    assert.equal(targets[0].kind, 'packed-dir')
    assert.ok(targets[0].display.endsWith('.zip'))
    const out = await sendFiles({
      ip: '127.0.0.1', port, alias: 'unit-tester', files: [targets[0].sendPath],
      protocol: 'http', maxFileBytes: 5 * 1024 * 1024,
      prepareTimeoutMs: 5000, uploadTimeoutMs: 5000,
    })
    assert.equal(out.results.length, 1)
    const got = Object.values(uploads)[0]
    assert.ok(got, 'receiver captured upload')
    assert.ok(got.fileName.endsWith('.zip'))
    assert.equal(got.buffer.readUInt32LE(0), 0x04034b50, 'uploaded bytes are a zip')
    assert.ok(got.buffer.length > 0)
    await cleanupTemps(temps)
  } finally {
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
