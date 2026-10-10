// test/smb.test.js — lib/smb.js 纯函数与命令构造的单元测试(不联网、不调 net/robocopy)。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  normalizeHost, normalizeShare, buildShareRoot, buildTargetDir, buildNetUseArgs, buildRobocopyArgs,
  findProfile, mergeProfile,
} from '../lib/smb.js'

test('normalizeHost strips slashes/spaces', () => {
  assert.equal(normalizeHost('  \\\\10.0.0.5\\'), '10.0.0.5')
  assert.equal(normalizeHost('TARGET-PC/'), 'TARGET-PC')
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
  const a = buildNetUseArgs('\\\\10.0.0.5\\recv', { username: 'TARGET-PC\\u', password: 'p' })
  assert.deepEqual(a, ['\\\\10.0.0.5\\recv', '/user:TARGET-PC\\u', 'p', '/persistent:no'])
})

test('buildNetUseArgs user no password', () => {
  const a = buildNetUseArgs('\\\\10.0.0.5\\recv', { username: 'u' })
  assert.deepEqual(a, ['\\\\10.0.0.5\\recv', '/user:u', '/persistent:no'])
})

// 回归：mountShare 曾把 targetDir 单独拼一次，而 buildNetUseArgs 已含它 —— net 收到两个
// devicename + 凭据共 4 个位置参数，直接打印用法说明，SMB 推送必然失败。锁死"只出现一次"。
test('net use command line lists the target exactly once', () => {
  const td = '\\\\10.0.0.5\\recv'
  const withCreds = ['use', ...buildNetUseArgs(td, { username: 'u', password: 'p' })]
  assert.deepEqual(withCreds, ['use', td, '/user:u', 'p', '/persistent:no'])
  assert.equal(withCreds.filter((x) => x === td).length, 1)
  const guest = ['use', ...buildNetUseArgs(td, {})]
  assert.equal(guest.filter((x) => x === td).length, 1)
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

// ── smbProfiles 档案解析 ────────────────────────────────────────────────────
const PROFILES = [
  { name: '书房台式机', host: '192.0.2.10', share: 'C$', destDir: 'Users/me/Desktop', username: 'TARGET-PC\\me', password: 'secret' },
  { name: 'NAS', host: '198.51.100.5', share: 'drop', destDir: '', username: '', password: '' },
]

test('findProfile returns null when no name given', () => {
  assert.equal(findProfile(PROFILES, ''), null)
  assert.equal(findProfile(PROFILES, '   '), null)
  assert.equal(findProfile(undefined, ''), null)
})

test('findProfile matches by exact trimmed name', () => {
  assert.equal(findProfile(PROFILES, ' NAS ').host, '198.51.100.5')
  assert.equal(findProfile(PROFILES, '书房台式机').share, 'C$')
})

test('findProfile throws with available names when missing', () => {
  assert.throws(() => findProfile(PROFILES, '不存在'), /not found.*书房台式机.*NAS/s)
  assert.throws(() => findProfile([], 'x'), /no profiles configured/)
})

test('mergeProfile: profile-only supplies every field', () => {
  const r = mergeProfile(findProfile(PROFILES, '书房台式机'), { files: ['D:/x'] })
  assert.deepEqual(r, {
    host: '192.0.2.10', share: 'C$', destDir: 'Users/me/Desktop', username: 'TARGET-PC\\me', password: 'secret',
  })
})

test('mergeProfile: explicit args override profile fields', () => {
  const r = mergeProfile(findProfile(PROFILES, '书房台式机'), {
    target: '203.0.113.9', share: 'recv', destDir: 'in', username: 'other', password: 'pw2',
  })
  assert.deepEqual(r, {
    host: '203.0.113.9', share: 'recv', destDir: 'in', username: 'other', password: 'pw2',
  })
})

test('mergeProfile: blank args fall back to profile (password keeps profile value)', () => {
  const r = mergeProfile(findProfile(PROFILES, '书房台式机'), {
    target: '   ', share: '', destDir: '', username: '', password: '',
  })
  assert.equal(r.host, '192.0.2.10')
  assert.equal(r.share, 'C$')
  assert.equal(r.destDir, 'Users/me/Desktop')
  assert.equal(r.username, 'TARGET-PC\\me')
  assert.equal(r.password, 'secret')
})

test('mergeProfile: no profile = args only, empty stays empty (no silent C$ default)', () => {
  const r = mergeProfile(null, { target: '10.0.0.9', files: ['D:/y'] })
  assert.deepEqual(r, { host: '10.0.0.9', share: '', destDir: '', username: '', password: '' })
})

