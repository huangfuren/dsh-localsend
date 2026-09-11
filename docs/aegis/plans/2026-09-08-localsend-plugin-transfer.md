# dsh-localsend v0.3.0 — Plugin Transfer via Zero-Requirement Link

## Goal

Add two capabilities to dsh-localsend without breaking any existing tool:

1. **`localsend_send_plugin`** — package a DSH plugin directory into a self-contained
   `*.dsh-plugin.zip` (Zarf/Claude-marketplace style: manifest + one-command install card),
   share it over a temporary HTTP link that the receiver opens in **any browser**
   (zero device requirement — no LocalSend app, no DSH, no extra software needed to download).
2. **Structured transfer output** — upgrade `localsend_share` (and the new plugin tool) from a
   log string to a structured output schema so the UI can render sizes/progress.

Covers both halves of the user's ask: "把插件也便捷传输" and "升级传输功能", under the
decided constraint **接收方没有设备要求** (receiver needs nothing but a browser).

Out of scope (deliberate, YAGNI):
- Receiver-side auto-install. That would require code running on the receiver, which contradicts
  "zero device requirement". The manifest + INSTALL.md give a copy-paste one-liner instead.
  A future `localsend_install_plugin` (receiver-side, requires DSH + this plugin on both ends)
  can consume the same manifest later.
- mDNS discovery, LocalSend pull-mode (`/download`), PIN/auto-accept. LocalSend App protocol
  stays push-only and unchanged.
- Streaming upload for the LocalSend App path (`buildFileEntries` keeps its 1 GiB whole-file cap).

## Architecture

Zero-requirement channel is the existing `lib/share.js` HTTP one-time server. The plugin tool is
a **packaging + sharing composition**, not a new transport:

```
plugin dir (or name)
  → packPlugin()            [new lib/plugin-pack.js]
      walk with exclusions (node_modules/, .git/, .DS_Store, Thumbs.db, *.log)
      read package.json (name/version/engines.dsh) + dsh.plugin.json (id, tools)
      emit dsh-plugin.manifest.json (Zarf-style: file list + sha256 + install template)
      emit INSTALL.md (Claude-marketplace style one-liner card)
      createZip()            [existing lib/zip.js, zero-dep]
  → createShareSession()     [existing lib/share.js — HTTP link, password, expiry, Range]
  → structured output {url, name, version, size, manifest, installCommand}
```

New files carry new responsibility; existing transport/pack/zip modules are reused, not modified
(except one additive output-schema change in `lib/tools/share.js`).

## Tech Stack

Node.js ≥ 22.19 ESM, zero runtime deps in `lib/` (existing constraint, keep it — `zip.js` and
`share.js` already prove the pattern). Tests: `node:test` + `node:assert/strict` (matches
`test/unit.test.js` / `test/zip.test.js` / `test/mock.test.js` style). No build step; source
files ARE the shipped files.

## Baseline / Authority Refs

- `docs/aegis/baseline/2026-09-08-initial-baseline.md` (this repo, just written)
- `lib/share.js` — `createShareSession()` signature and session shape (lines 244–301)
- `lib/pack.js` — `collectDirectory()` walk pattern, `resolveSendTargets()`, `cleanupTemps()`
- `lib/zip.js` — `createZip(entries)` contract (`{name, data}[]`, '/' separators)
- `lib/tools/share.js` — existing tool registration + output pattern
- `index.js` — Config schema + `ctx.tools.register` wiring
- Borrowed models: Zarf (`zarf.yaml` manifest + one-command deploy),
  Claude Code marketplaces (manifest-driven one-command install), LocalSend protocol (kept
  push-only; pull/mDNS/PIN explicitly deferred)

## Compatibility Boundary

- Existing tools keep their names, params, and string outputs: `localsend_list_devices`,
  `localsend_send_files` untouched; `localsend_share` **gains** a structured `output` schema but
  keeps accepting the same parameters (additive, not breaking).
- New tool name `localsend_send_plugin` must not collide (checked: no such export today).
- Zero new runtime dependencies. `lib/plugin-pack.js` uses only `node:` builtins + existing
  `./zip.js`.
- Plugin package format is versioned (`"format": "dsh-plugin-package", "version": 1`) so a future
  receiver-side installer can gate on it.
- dsh plugin version bump: **0.2.0 → 0.3.0** (new public tool = minor, not patch).

## TDD Route

```text
TDD Route:
- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Strict signals: new public tool + new packaging surface exist, but user TDD mode is off and no
  strict request was made; risk is contained by deterministic pure functions (walk/manifest/zip)
  plus an end-to-end mock test.
- Light eligibility: n/a (mode off)
- TDD-fit exception: n/a
- Test posture: post-change regression (unit + zip-manifest + e2e share-session test)
- Reason: plugin host convention (outline-auto precedent) is `npm run verify` after change, not
  strict RED/GREEN; the deterministic functions are cheap to verify directly.
- Verification: `npm run verify` (check + node --test) after each task; e2e test boots a real
  share server on 127.0.0.1 and downloads the produced zip.
```

## Verification

- `npm run verify` after every task (runs `node --check` on every lib/tool file + full
  `node --test test/`).
- New tests:
  - `test/plugin-pack.test.js` — exclusion rules, manifest shape, INSTALL.md content, zip
    round-trip via the same `parseZip` helper used by `test/zip.test.js`.
  - end-to-end in `test/plugin-pack.test.js` — `packPlugin()` → `createShareSession()` → HTTP GET
    on `127.0.0.1:<port>/dl/<token>` → bytes parse as zip → manifest matches entry hashes.
- Manual smoke (documented, not automated): share a real plugin dir, open link in browser,
  download, run the printed `dsh plugin --profile web add link:...` on a second machine.

## Scope Check

```text
Aegis Visibility: the slice adds a new public tool and a new package format; contract + release
surface pressure makes a written plan useful before execution.

Plan Basis: conversation-approved direction (HTTP link channel, exclude node_modules, both
"distribute other plugins" and "distribute localsend itself" via one tool). No separate spec
brief; this plan is the first durable artifact.

BaselineUsageDraft:
- Required baseline refs: docs/aegis/baseline/2026-09-08-initial-baseline.md
- Delivered context refs: none (host did not inject a baseline payload)
- Acknowledged before plan refs: full read of lib/* and test/* (list above)
- Cited in plan refs: baseline file + lib/share.js + lib/pack.js + lib/zip.js + index.js
- Missing refs: none
- Decision: continue

Requirement Ready Check:
- Requirement source refs: user messages in this conversation (两个都要 / 接收方没有设备要求 /
  排除 node_modules) + borrowed-model research digest
- Goals and scope refs: Goal section above
- User / scenario refs: "局域网另一台机器，浏览器打开链接拿插件，一条命令安装"
- Requirement item refs: (1) send_plugin tool (2) structured output (3) zero-dep packaging
- Acceptance / verification criteria refs: Verification section (automated) + manual smoke
- Open blocker questions: none — the three decision points were answered by the user
- Decision: ready

Change Necessity:
- User-visible need: transfer a DSH plugin to a LAN machine that has nothing installed except a
  browser, and get a deterministic one-command install on arrival.
- No-change / non-code option: insufficient — `localsend_share` can already zip a folder, but it
  has no plugin awareness (would ship node_modules), no manifest, no install card, and no
  version/name extraction; the receiver would get an opaque zip.
- Why code change is necessary: packaging intelligence (exclusions, manifest, INSTALL.md) and a
  dedicated tool surface are new behavior, not configuration.
- Minimum change boundary: one new lib file (plugin-pack.js), one new tool file
  (tools/send-plugin.js), one registration line + one config field in index.js, one additive
  output schema in tools/share.js, package.json version bump, tests, docs.
- Decision: code-change

Existence Check:
- Proposed new surface: `localsend_send_plugin` tool + `lib/plugin-pack.js` + package format v1
- Existing owner / reuse candidate: `localsend_share` + `lib/pack.js` `packDirectory()`
- Why existing surface is insufficient: `packDirectory()` walks everything (would ship
  node_modules), emits no manifest, no INSTALL.md, no plugin metadata; `localsend_share` accepts
  arbitrary paths, not "a plugin", and returns a log string with no install command.
- Creation proof: the manifest + install card are the entire borrowed value (Zarf/Claude model);
  they cannot be produced by the existing walk.
- Entropy / retirement impact: one new tool + one new lib file; no old owner is retired or
  duplicated — `localsend_share` stays the general-purpose file share.
- Decision: add-with-proof

Architecture Integrity Lens:
- Invariant: transport stays in lib/share.js; packaging stays in lib/plugin-pack.js; tools only
  compose and format output.
- Canonical owner / contract: plugin-package format v1 is owned by lib/plugin-pack.js (single
  producer; future receiver-side installer is the consumer).
- Responsibility overlap: none — plugin-pack does NOT reimplement zip (reuses zip.js) or the HTTP
  server (reuses share.js).
- Higher-level simplification considered: fold plugin packing into pack.js as an option. Rejected:
  pack.js is generic-path code used by two existing tools; mixing plugin semantics there would
  couple a generic walker to plugin metadata. A separate file is the lower-entropy boundary.
- Retirement / falsifier: if a future receiver-side installer lands, INSTALL.md text and the
  manifest `install` block may be replaced — format version field exists for exactly that.
- Verdict: proceed with the new-file boundary.

Plan Pressure Test:
- Owner / contract / retirement: format v1 versioned; new tool additive; no retirement.
- Architecture integrity / higher-level path: verified above (separate file, reuse zip/share).
- Verification scope: unit + zip round-trip + real HTTP e2e on 127.0.0.1 — all offline-safe.
- Task executability: every step below has complete code; no placeholders.
- Pressure result: proceed

Complexity Budget:
- Artifact class: new tool + new lib module in an existing zero-dep plugin
- Target files / artifacts: lib/plugin-pack.js, lib/tools/send-plugin.js, index.js,
  lib/tools/share.js, test/plugin-pack.test.js, README*, CHANGELOG.md, package.json
- Current pressure: lib/ = 9 files, 3 tools — low
- Projected post-change pressure: lib/ = 10 files, 4 tools — low
- Budget result: within-budget
- Planned governance: none needed

Plan-Time Complexity Check:
- Target files: lib/plugin-pack.js (new, ~120 lines), lib/tools/send-plugin.js (new, ~80 lines)
- Existing size / shape signals: tools/*.js are 40–100 lines each; lib/*.js are 60–300 lines
- Owner fit: matches existing one-lib-file-per-concern layout
- Add-in-place risk: low; no existing file gains more than ~15 lines
- Better file boundary: separate plugin-pack.js (rejected add-in-place into pack.js, reason above)
- Recommendation: add owner file (as planned)
```

## Execution Readiness View

```text
Execution Readiness View:
- Intent Lock: add zero-requirement plugin transfer (manifest-carrying zip over HTTP link) +
  structured share output; version 0.3.0.
- Scope Fence: lib/plugin-pack.js (new), lib/tools/send-plugin.js (new), index.js (+2 lines),
  lib/tools/share.js (additive output schema), test/plugin-pack.test.js (new), README.zh-CN.md,
  README.md, CHANGELOG.md, package.json (version). Nothing else.
- Baseline Lock: docs/aegis/baseline/2026-09-08-initial-baseline.md
- Approved Behavior: pack plugin dir (exclusions) → manifest+INSTALL → HTTP link; share tool
  returns structured output; existing tools unchanged in behavior.
- Owner / Contract Constraints: zero new runtime deps; format v1 versioned; zip/share reused.
- Compatibility Boundary: additive only; localsend_share keeps its params; no tool renamed.
- Retirement Boundary: nothing retired.
- Task Batches: T1 pack core, T2 tool+wire, T3 structured share output, T4 docs+version.
- Test Obligations: npm run verify green after each task; plugin-pack e2e proves HTTP download.
- Review Gates: user reviews this plan; commits after each verified task.
- Drift / Rewind Rules: if share-session e2e proves flaky on Windows temp paths, pin tmpdir under
  the repo's test dir and note it in the test file header.
- Evidence Required Before Completion: npm run verify output + e2e test name list.
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or
  completion authority.
```

---

## Files

| Path | Action | Why |
|---|---|---|
| `lib/plugin-pack.js` | create | plugin-aware packaging: exclusions + manifest + INSTALL.md |
| `lib/tools/send-plugin.js` | create | `localsend_send_plugin` tool (compose pack + share) |
| `index.js` | modify (+4 lines) | import/register new tool; `dshProfileDir` config field |
| `lib/tools/share.js` | modify (~12 lines) | structured output schema + same log text kept |
| `test/plugin-pack.test.js` | create | unit + zip round-trip + HTTP e2e |
| `package.json` | modify | version 0.3.0; add send-plugin.js to `files` + `check` script |
| `README.zh-CN.md` / `README.md` | modify | document the new tool |
| `CHANGELOG.md` | modify | 0.3.0 entry |
| `docs/aegis/INDEX.md` | create | workspace index (already partially scaffolded) |

---

## Tasks

### Task 1 — `lib/plugin-pack.js`: packaging core

**Files:** create `lib/plugin-pack.js`; create `test/plugin-pack.test.js` (unit part)

**Why:** the entire borrowed value (Zarf manifest + Claude-style install card) lives here; the
existing `packDirectory()` cannot produce it.

**Change Necessity:** minimum boundary is one new lib file reusing `zip.js`; no edits to
`pack.js`/`zip.js`/`share.js` in this task.

**Impact/Compatibility:** additive; nothing imports it yet (tool wires up in Task 2).

**Complete code — `lib/plugin-pack.js`:**

```js
// lib/plugin-pack.js — 把一个 DSH 插件目录打成自包含分发包:
// 排除 node_modules/.git 等本地物 → 生成 dsh-plugin.manifest.json(Zarf 式清单)
// + INSTALL.md(Claude 市场式一条命令安装卡) → 零依赖 zip。
// 复用 lib/zip.js;不引入第三方依赖。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createZip } from './zip.js'

// 打包时排除的目录名(任意深度匹配)与文件名。
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist-tsbuildinfo'])
const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const EXCLUDED_EXTS = new Set(['.log', '.tmp'])

const PACKAGE_FORMAT = 'dsh-plugin-package'
const PACKAGE_FORMAT_VERSION = 1

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function isExcluded(name, isDir) {
  if (isDir) return EXCLUDED_DIRS.has(name)
  if (EXCLUDED_FILES.has(name)) return true
  return EXCLUDED_EXTS.has(path.extname(name).toLowerCase())
}

/** 递归收集(排除本地物),返回 [{name(zip 内相对路径), data}]。 */
export async function collectPluginFiles(dir, { onSkip } = {}) {
  const entries = []
  async function walk(abs, rel) {
    const dirents = await fs.promises.readdir(abs, { withFileTypes: true })
    for (const d of dirents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (isExcluded(d.name, d.isDirectory())) {
        if (onSkip) onSkip(`${rel ? rel + '/' : ''}${d.name}`)
        continue
      }
      const relChild = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        await walk(path.join(abs, d.name), relChild)
      } else if (d.isFile()) {
        entries.push({ name: relChild, data: await fs.promises.readFile(path.join(abs, d.name)) })
      }
    }
  }
  await walk(dir, '')
  return entries
}

/** 读插件元信息:package.json 必需;dsh.plugin.json 可选。 */
export async function readPluginMeta(dir) {
  const pkgRaw = await fs.promises.readFile(path.join(dir, 'package.json'), 'utf8')
    .catch(() => { throw new Error(`not a DSH plugin (package.json missing): ${dir}`) })
  let pkg
  try { pkg = JSON.parse(pkgRaw) } catch (e) { throw new Error(`package.json unparseable: ${e.message}`) }
  if (!pkg.name) throw new Error('package.json has no "name"')
  const dshPlugin = await fs.promises.readFile(path.join(dir, 'dsh.plugin.json'), 'utf8')
    .then((raw) => JSON.parse(raw)).catch(() => null)
  return {
    name: String(pkg.name),
    version: String(pkg.version || '0.0.0'),
    minDsh: String(pkg.engines?.dsh || dshPlugin?.engines?.dsh || '>=0.1.0'),
    pluginId: String(dshPlugin?.id || pkg.name),
    tools: Array.isArray(dshPlugin?.contributes?.tools) ? dshPlugin.contributes.tools : [],
    description: String(pkg.description || ''),
  }
}

/** 生成清单对象。files 为 [{name, size, sha256}](zip 内相对路径)。 */
export function buildManifest(meta, files, { installDirTemplate }) {
  return {
    format: PACKAGE_FORMAT,
    formatVersion: PACKAGE_FORMAT_VERSION,
    name: meta.name,
    pluginId: meta.pluginId,
    version: meta.version,
    minDsh: meta.minDsh,
    description: meta.description,
    entry: 'lib/index.js',
    tools: meta.tools,
    files: files.map((f) => ({ name: f.name, size: f.data.length, sha256: sha256hex(f.data) })),
    install: {
      command: `dsh plugin --profile web add link:${installDirTemplate}`,
      deps: 'pnpm install --dir <解压目录>',
    },
  }
}

/** 生成 INSTALL.md 文本(接收端没有任何前置软件,解压后照抄一条命令)。 */
export function buildInstallMd(meta, manifest) {
  return [
    `# ${meta.name} v${meta.version} — 安装说明`,
    '',
    '这是通过 dsh-localsend 分发的 DSH 插件包。接收机器只需要:已安装 DSH。',
    '',
    '## 安装(复制粘贴)',
    '',
    '```bash',
    '# 1. 解压本 zip 到任意目录,例如:',
    `#    C:\\Users\\<你>\\dsh-plugins\\${meta.name}`,
    '# 2. 在该目录安装依赖(包内不含 node_modules):',
    `pnpm install --dir <解压目录>`,
    '# 3. 以 link 方式装入 profile:',
    manifest.install.command.replace('<解压目录>', `<解压目录>\\${''}`) + path.sep + meta.name,
    '# 4. 重启 dsh web',
    '```',
    '',
    '## 校验(可选)',
    '',
    '包内 `dsh-plugin.manifest.json` 列出了每个文件的 sha256。解压后核对:',
    '',
    '```bash',
    `sha256sum <解压目录>/${meta.name}/*`,
    '```',
    '',
    `## 元信息`,
    '',
    `- 插件 id: \`${meta.pluginId}\``,
    `- 工具: ${meta.tools.length ? meta.tools.map((t) => '`' + t + '`').join(', ') : '(无)'}`,
    `- DSH 版本要求: \`${meta.minDsh}\``,
    '',
    '---',
    `由 dsh-localsend 生成 · 包格式 ${PACKAGE_FORMAT} v${PACKAGE_FORMAT_VERSION}`,
    '',
  ].join('\n')
}

/**
 * 把插件目录打成自包含 zip。
 * @returns {Promise<{zipPath, fileName, meta, manifest, installMd, size, temps:string[]}>}
 */
export async function packPlugin(pluginDir, { tmpDir = os.tmpdir(), onSkip } = {}) {
  const st = await fs.promises.stat(pluginDir).catch(() => null)
  if (!st || !st.isDirectory()) throw new Error(`plugin dir not found: ${pluginDir}`)
  const meta = await readPluginMeta(pluginDir)
  const files = await collectPluginFiles(pluginDir, { onSkip })
  if (files.length === 0) throw new Error(`plugin dir is empty after exclusions: ${pluginDir}`)

  // 安装命令模板用接收端常见解压根做占位;INSTALL.md 里解释如何替换。
  const installDirTemplate = `<解压目录>${path.sep}${meta.name}`
  const manifest = buildManifest(meta, files, { installDirTemplate })
  const installMd = buildInstallMd(meta, manifest)

  const all = [
    ...files,
    { name: 'dsh-plugin.manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
    { name: 'INSTALL.md', data: Buffer.from(installMd, 'utf8') },
  ]
  const buffer = createZip(all.map((f) => ({ name: `${meta.name}/${f.name}`, data: f.data })))
  const fileName = `${meta.name}-${meta.version}.dsh-plugin.zip`
  const zipPath = path.join(tmpDir, `${crypto.randomUUID()}-${fileName}`)
  await fs.promises.writeFile(zipPath, buffer)
  return {
    zipPath,
    fileName,
    meta,
    manifest,
    installMd,
    size: buffer.length,
    temps: [zipPath],
  }
}
```

**Complete code — `test/plugin-pack.test.js` (unit part; e2e appended in Task 2):**

```js
// test/plugin-pack.test.js — 插件打包核心:排除规则/清单/安装卡/zip 往返。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { buildManifest, collectPluginFiles, packPlugin, readPluginMeta } from '../lib/plugin-pack.js'
import { crc32 } from '../lib/zip.js'

/** 与 test/zip.test.js 相同的极简 zip 解析(为独立可读而复制,非共享导入)。 */
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
```

**Verification (exact commands):**

```bash
cd /d D:\deepseek\dsh-plugin\mine\dsh-localsend
node --check lib/plugin-pack.js
node --test test/plugin-pack.test.js
```

Expected: `# pass 5` (or 5+ with any added assertions), `# fail 0`.

---

### Task 2 — `localsend_send_plugin` tool + wiring

**Files:** create `lib/tools/send-plugin.js`; modify `index.js`; extend `test/plugin-pack.test.js` (e2e)

**Why:** exposes the packaging core as a user-facing tool over the zero-requirement HTTP channel.

**Change Necessity:** minimum boundary is one new tool file + registration in `index.js`; no
transport changes.

**Impact/Compatibility:** additive tool; `index.js` gains one import, one register call, one
config field with a safe default.

**Complete code — `lib/tools/send-plugin.js`:**

```js
// lib/tools/send-plugin.js — localsend_send_plugin:把一个 DSH 插件目录打成
// 自包含分发包(排除 node_modules/.git,内含 manifest + 安装卡),
// 经临时 HTTP 链接分享——接收方用浏览器打开即可下载,无需安装任何软件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { TOOL_TIMEOUT_MS } from '../constants.js'
import { packPlugin } from '../plugin-pack.js'
import { getLocalIp, createShareSession } from '../share.js'

function humanSize(n) {
  return n < 1024 ? `${n} B`
    : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB`
    : n < 1024 * 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 把"路径或已安装插件名"解析成插件目录。 */
export async function resolvePluginDir(input, { dshProfileDir } = {}) {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('plugin is required: a directory path or an installed plugin name')
  const st = await fs.promises.stat(raw).catch(() => null)
  if (st?.isDirectory()) return path.resolve(raw)
  // 按名字在 profile 的 node_modules 里找(只读,不改 profile)。
  const profileDir = dshProfileDir
    || process.env.DSH_PROFILE_DIR
    || path.join(os.homedir(), '.dsh')
  const candidates = []
  for (const profile of ['web', 'desktop']) {
    candidates.push(path.join(profileDir, 'profiles', profile, 'node_modules', raw))
  }
  candidates.push(path.join(profileDir, 'profiles', 'web', 'node_modules', '@deepseek-ai', raw))
  for (const c of candidates) {
    const s = await fs.promises.stat(c).catch(() => null)
    if (s?.isDirectory() && fs.existsSync(path.join(c, 'package.json'))) return c
  }
  throw new Error(`plugin not found: "${raw}" (tried as path and under ${profileDir}/profiles/*/node_modules)`)
}

export function defineSendPluginTool(getConfig) {
  return defineTool({
    name: 'localsend_send_plugin',
    description:
      'Package a DSH plugin directory into a self-contained <name>-<version>.dsh-plugin.zip ' +
      '(excludes node_modules and .git; includes dsh-plugin.manifest.json with per-file sha256 ' +
      'and an INSTALL.md one-command install card) and share it over a temporary HTTP link. ' +
      'The receiver needs NOTHING installed — they open the link in any browser on the same LAN ' +
      'and download the zip. `plugin` accepts an absolute directory path or an installed plugin ' +
      'name (resolved read-only under ~/.dsh/profiles/*/node_modules). Only send plugins the ' +
      'user explicitly asked to send.',
    parameters: {
      plugin: { type: 'string', description: 'Plugin directory path OR installed plugin name (e.g. dsh-outline-auto).' },
      password: { type: 'string', description: 'Optional download password. Empty = no password.' },
      expiresIn: { type: 'number', description: 'Link validity in seconds (default 3600). 0 = no expiry (closes after download).' },
      port: { type: 'number', description: 'Listen port (default 0 = random available port).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          plugin: { type: 'string' },
          version: { type: 'string' },
          zipName: { type: 'string' },
          size: { type: 'number' },
          installCommand: { type: 'string' },
          log: { type: 'string' },
        },
        required: ['url', 'plugin', 'version', 'zipName', 'size', 'installCommand', 'log'],
      },
      render: (_args, v) => [{ type: 'text', text: v.log }],
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const cfg = getConfig()
      const logs = []
      const log = (s) => logs.push(s)

      const pluginDir = await resolvePluginDir(args.plugin, { dshProfileDir: cfg.dshProfileDir })
      log(`plugin dir: ${pluginDir}`)

      const packed = await packPlugin(pluginDir, {
        tmpDir: os.tmpdir(),
        onSkip: (n) => log(`excluded: ${n}`),
      })
      log(`packed ${packed.fileName} (${packed.size} B, format v${packed.manifest.formatVersion})`)

      const password = String(args.password || '').trim()
      const expiresIn = Math.max(0, Number(args.expiresIn ?? 3600) || 3600)
      const port = Number(args.port ?? 0) || 0

      try {
        const session = await createShareSession({
          files: [packed.zipPath],
          alias: `${packed.meta.name} v${packed.meta.version} (dsh-localsend)`,
          password,
          expiresIn,
          port,
          onLog: log,
          signal: exec.signal,
        })
        log('')
        log(`✅ 插件包已就绪，接收方浏览器打开即可下载（无需安装任何软件）：`)
        log(`   ${session.url}`)
        if (password) log('   🔒 需要密码')
        log(`   ⏱ 有效期: ${expiresIn > 0 ? `${expiresIn} 秒` : '下载完成自动关闭'}`)
        log(`   📦 ${packed.fileName} (${humanSize(packed.size)})`)
        log('')
        log(`接收端安装（解压后执行）:`)
        log(`   pnpm install --dir <解压目录>/${packed.meta.name}`)
        log(`   dsh plugin --profile web add link:<解压目录>/${packed.meta.name}`)
        log(`   然后重启 dsh web`)

        // 阻塞等待下载完成/过期/取消,与 localsend_share 行为一致。
        await new Promise((resolve) => {
          session.onDone = (reason) => {
            log(`\n✅ 分享结束: ${reason}`)
            resolve()
          }
          if (exec.signal) exec.signal.addEventListener('abort', () => resolve(), { once: true })
        })

        return {
          url: session.url,
          plugin: packed.meta.name,
          version: packed.meta.version,
          zipName: packed.fileName,
          size: packed.size,
          installCommand: `dsh plugin --profile web add link:<解压目录>/${packed.meta.name}`,
          log: logs.join('\n'),
        }
      } finally {
        for (const t of packed.temps) { try { await fs.promises.unlink(t) } catch { /* 忽略 */ } }
      }
    },
  })
}
```

**Modify `index.js` — exact edits (4 additive lines + 1 config field):**

Add to imports (after the existing three tool imports):

```js
import { defineSendPluginTool } from './lib/tools/send-plugin.js'
```

Add to `Config` schema (inside `Schema.object({...})`, after `sharePassword`):

```js
  dshProfileDir: Schema.string().default('').description('DSH home dir used to resolve installed plugin names. Empty = ~/.dsh.'),
```

Add to `entryConfig` defaults (after `maxFileBytes`):

```js
    dshProfileDir: '',
```

Add registration (after the existing three `ctx.tools.register` calls):

```js
  ctx.tools.register(defineSendPluginTool(getConfig))
```

**Extend `test/plugin-pack.test.js` — append e2e (real HTTP server on 127.0.0.1):**

```js
// ---- e2e: packPlugin → createShareSession → HTTP GET 下载并核对 zip ----
import { createShareSession } from '../lib/share.js'

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
```

**Verification (exact commands):**

```bash
node --check lib/tools/send-plugin.js
node --check index.js
node --test test/plugin-pack.test.js
```

Expected: all pass, including the new e2e (`# pass 6`).

---

### Task 3 — structured output for `localsend_share`

**Files:** modify `lib/tools/share.js` (~12 lines)

**Why:** the "升级传输功能" half — the share tool currently returns a log string; a structured
schema lets the UI render size/progress and lets the AI read fields without parsing text.

**Change Necessity:** additive output schema on an existing tool; keep the human-readable log as
a field so the current UX is unchanged.

**Impact/Compatibility:** `localsend_share` keeps every parameter; only its `output` changes from
`{ type: 'string' }` to an object that embeds the same text in `log`.

**Exact edits in `lib/tools/share.js`:**

1. Replace the `output` block:

```js
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, size: { type: 'number' } }, required: ['name', 'size'] } },
          totalSize: { type: 'number' },
          expiresIn: { type: 'number' },
          password: { type: 'boolean' },
          log: { type: 'string' },
        },
        required: ['url', 'files', 'totalSize', 'expiresIn', 'password', 'log'],
      },
      render: (_args, v) => [{ type: 'text', text: v.log }],
    },
```

2. In `execute`, capture `session` fields before the wait and change the single `return`:

```js
        const shareFiles = session.files.map((f) => ({ name: f.name, size: f.size }))
        const totalSize = shareFiles.reduce((s, f) => s + f.size, 0)
```

and replace the final `return logs.join('\n')` with:

```js
        return {
          url: session.url,
          files: shareFiles,
          totalSize,
          expiresIn,
          password: Boolean(password),
          log: logs.join('\n'),
        }
```

(Delete the now-unused local `const totalSize = session.files.reduce(...)` log line that
recomputed the same value — the log text is built from `humanSize`-style lines already present.)

**Verification:**

```bash
node --check lib/tools/share.js
node --test test/
```

Expected: full suite green; `localsend_share` behavior unchanged for existing callers (log text
identical).

---

### Task 4 — version, docs, changelog, workspace index

**Files:** modify `package.json`, `README.zh-CN.md`, `README.md`, `CHANGELOG.md`; create
`docs/aegis/INDEX.md`

**Why:** release surface — version bump is minor (new public tool), docs must teach the
zero-requirement workflow, changelog records the format contract.

**Exact edits:**

`package.json`:
- `"version": "0.3.0"`
- add `"lib/plugin-pack.js"` is already covered by `"lib"` in `files` — no change needed there;
  extend the `check` script by appending ` && node --check lib/plugin-pack.js && node --check lib/tools/send-plugin.js`

`CHANGELOG.md` (prepend):

```markdown
## [0.3.0] - 2026-09-08

### Added

- **`localsend_send_plugin`**: package a DSH plugin directory into a self-contained
  `<name>-<version>.dsh-plugin.zip` (excludes `node_modules`/`.git`; includes
  `dsh-plugin.manifest.json` with per-file sha256 and an INSTALL.md one-command install card)
  and share it over a temporary HTTP link. The receiver needs nothing but a browser on the
  same LAN.
- Package format `dsh-plugin-package` v1: manifest lists name/version/minDsh/tools and every
  packaged file with its sha256, plus an install command template.
- `localsend_share` now returns a structured output (url, per-file sizes, total, expiry,
  password flag) while keeping the same human-readable log text.
- Config: `dshProfileDir` (default `~/.dsh`) to resolve installed plugin names read-only.
```

`README.zh-CN.md` — add to the tools/feature section:

```markdown
### 传插件（接收方零要求）

`localsend_send_plugin` 把一个 DSH 插件目录打成自包含分发包（排除 `node_modules`、`.git`，内含
`dsh-plugin.manifest.json` 清单与 `INSTALL.md` 安装卡），并生成临时 HTTP 下载链接——接收方在
同一局域网内用**任何浏览器**打开即可下载，无需安装 LocalSend 或 DSH。

`plugin` 参数接受绝对目录路径，或已安装插件名（只读地在 `~/.dsh/profiles/*/node_modules` 下解析）。
```

`README.md` — mirror the same section in English.

`docs/aegis/INDEX.md`:

```markdown
# INDEX

- plan: docs/aegis/plans/2026-09-08-localsend-plugin-transfer.md — dsh-localsend v0.3.0 plugin transfer via zero-requirement link
- baseline: docs/aegis/baseline/2026-09-08-initial-baseline.md
```

**Verification:**

```bash
npm run verify
```

Expected: `check` passes (all files syntax-checked) and the full `node --test test/` suite is
green.

---

## Self-Review

1. **Spec coverage** — "传别的插件" + "分发 localsend 自身" both route through
   `localsend_send_plugin` (same tool, different `plugin` arg); "接收方零要求" is the HTTP link;
   "排除 node_modules" is `EXCLUDED_DIRS`; "升级传输功能" is Task 3. ✅
2. **Placeholder scan** — every code block is complete; the only `<解压目录>` strings are
   deliberate receiver-side placeholders documented in INSTALL.md, not plan placeholders. ✅
3. **Type consistency** — `packPlugin()` returns `{zipPath, fileName, meta, manifest, installMd,
   size, temps}`; Task 2 consumes exactly those fields; `createShareSession()` is called with its
   existing signature (`files, alias, password, expiresIn, port, onLog, signal`). ✅
4. **Compatibility** — additive only; `localsend_share` keeps params; no tool renamed; format
   versioned; zero new deps. ✅
5. **Change necessity** — stated per task; minimum boundaries named. ✅
6. **Existence check** — add-with-proof recorded; `localsend_share` not duplicated. ✅
7. **Complexity/minimality** — within budget; separate file justified over add-in-place. ✅
8. **Architecture integrity** — transport stays in share.js; packaging owns the format; tools
   only compose. ✅
9. **Verification** — exact commands per task, all offline (`127.0.0.1`). ✅
10. **Dual-track / ADR** — nothing retired; borrow-sources (Zarf/Claude/LocalSend) recorded in
    Baseline refs for future ADR backfill if the format evolves. ✅

## Risks

- **`dshProfileDir` name resolution** may match a *dependency* named like a plugin (e.g. a
  scoped package). Mitigation: resolution requires a top-level `package.json` with a `name` and
  prefers unscoped paths first; it is read-only so worst case is a wrong-but-harmless zip.
- **Receiver-side install still manual.** Accepted by user decision (zero device requirement).
  A future receiver-side `localsend_install_plugin` can consume format v1 without change.
- **Windows temp cleanup** — same pattern as existing `cleanupTemps()`; tests force-remove with
  `fs.rmSync(..., { force: true })` in `finally`.

## Retirement

Nothing retired. `localsend_share` and `localsend_send_files` keep their exact current contracts.
