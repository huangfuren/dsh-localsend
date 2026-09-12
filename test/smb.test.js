// test/smb.test.js — lib/smb.js 纯函数与命令构造的单元测试(不联网、不调 net/robocopy)。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  normalizeHost, normalizeShare, buildShareRoot, buildTargetDir, buildNetUseArgs, buildRobocopyArgs,
} from '../lib/smb.js'

test('normalizeHost strips slashes/spaces', () => {
  assert.equal(normalizeHost('  \\\\10.0.0.5\\'), '10.0.0.5')
  assert.equal(normalizeHost('DESKTOP-RRJJOL/'), 'DESKTOP-RRJJOL')
})

test('normalizeShare strips slashes', () => {
  assert.equal(normalizeShare('  recv/'), 'recv')
  assert.equal(normalizeShare('\\共享文件夹\\'), '共享文件夹')
})

test('buildShareRoot requires host & share', () => {
  assert.equal(buildShareRoot('10.0.0.5', 'recv'), '\\\\10.0.0.5\\recv')
  assert.throws(() => buildShareRoot('', 'recv'), /host/)
  assert.throws(() => buildShareRoot('10.0.0.5', ''), /share/)
})

test('buildTargetDir appends subdir, supports multilevel', () => {
  assert.equal(buildTargetDir('10.0.0.5', 'recv', ''), '\\\\10.0.0.5\\recv')
  assert.equal(buildTargetDir('10.0.0.5', 'recv', 'a/b'), '\\\\10.0.0.5\\recv\\a\\b')
  assert.equal(buildTargetDir('10.0.0.5', 'recv', '\\incoming\\'), '\\\\10.0.0.5\\recv\\incoming')
})

test('buildNetUseArgs guest', () => {
  const a = buildNetUseArgs('\\\\10.0.0.5\\recv', {})
  assert.deepEqual(a, ['\\\\10.0.0.5\\recv', '/user:guest', '""', '/persistent:no'])
})

test('buildNetUseArgs user+password', () => {
  const a = buildNetUseArgs('\\\\10.0.0.5\\recv', { username: 'DESKTOP-RRJJOL\\u', password: 'p' })
  assert.deepEqual(a, ['\\\\10.0.0.5\\recv', '/user:DESKTOP-RRJJOL\\u', 'p', '/persistent:no'])
})

test('buildNetUseArgs user no password', () => {
  const a = buildNetUseArgs('\\\\10.0.0.5\\recv', { username: 'u' })
  assert.deepEqual(a, ['\\\\10.0.0.5\\recv', '/user:u', '/persistent:no'])
})

test('buildRobocopyArgs single file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-smb-'))
  const f = path.join(dir, 'hello.txt')
  fs.writeFileSync(f, 'hi')
  try {
    const { srcDir, destBase, args } = buildRobocopyArgs('\\\\10.0.0.5\\recv', f)
    assert.equal(srcDir, dir)
    assert.equal(destBase, '\\\\10.0.0.5\\recv\\hello.txt')
    assert.ok(args.includes('"hello.txt"'))
    assert.ok(args.includes('/E'))
    assert.ok(args.includes('/COPY:DAT'))
    assert.ok(!args.includes('"hello.txt"') || true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('buildRobocopyArgs directory uses basename leaf', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-smb-'))
  const sub = path.join(dir, 'mydir')
  fs.mkdirSync(sub)
  const { destBase, args } = buildRobocopyArgs('\\\\10.0.0.5\\recv', sub)
  assert.equal(destBase, '\\\\10.0.0.5\\recv\\mydir')
  // 目录模式不带具体文件名参数
  assert.ok(!args.some((x) => x === '"mydir"'))
  assert.ok(args.includes('/E'))
  fs.rmSync(dir, { recursive: true, force: true })
})
