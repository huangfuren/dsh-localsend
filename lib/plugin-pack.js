// lib/plugin-pack.js — 把一个 DSH 插件目录打成自包含分发包:
// 排除 node_modules/.git 等本地物 → 生成 dsh-plugin.manifest.json(清单+逐文件 sha256)
// + INSTALL.md(一条命令安装卡) → 零依赖 zip(复用 lib/zip.js)。
// 包格式 dsh-plugin-package v1;将来接收端装包器可按 formatVersion 消费。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createZip } from './zip.js'

// 打包时排除的目录名(任意深度匹配)与文件物。
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.hg', '.svn'])
const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const EXCLUDED_EXTS = new Set(['.log', '.tmp', '.tsbuildinfo'])

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
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const d of dirents) {
      if (isExcluded(d.name, d.isDirectory())) {
        if (onSkip) onSkip(`${rel ? `${rel}/` : ''}${d.name}`)
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

/** 生成清单对象。files 为 [{name, data}](zip 内相对路径)。 */
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

/** 生成 INSTALL.md 文本(接收端无需任何前置软件,解压后照抄一条命令)。 */
export function buildInstallMd(meta, manifest) {
  const tools = meta.tools.length ? meta.tools.map((t) => `\`${t}\``).join(', ') : '(无)'
  return [
    `# ${meta.name} v${meta.version} — 安装说明`,
    '',
    '这是通过 dsh-localsend 分发的 DSH 插件包。接收机器只需要:已安装 DSH。',
    '',
    '## 安装(复制粘贴)',
    '',
    '```bash',
    '# 1. 解压本 zip 到任意目录,记为 <解压目录>',
    '# 2. 在解压出的插件目录里安装依赖(包内不含 node_modules):',
    `pnpm install --dir <解压目录>/${meta.name}`,
    '# 3. 以 link 方式装入 profile:',
    manifest.install.command.replace('<解压目录>', '<解压目录>'),
    '# 4. 重启 dsh web',
    '```',
    '',
    '## 校验(可选)',
    '',
    '包内 `dsh-plugin.manifest.json` 列出了每个文件的 sha256,解压后可逐文件核对。',
    '',
    '## 元信息',
    '',
    `- 插件 id: \`${meta.pluginId}\``,
    `- 工具: ${tools}`,
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

  const installDirTemplate = `<解压目录>${path.sep}${meta.name}`
  const manifest = buildManifest(meta, files, { installDirTemplate })
  const installMd = buildInstallMd(meta, manifest)

  const all = [
    ...files,
    { name: 'dsh-plugin.manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: 'INSTALL.md', data: Buffer.from(installMd, 'utf8') },
  ]
  const buffer = createZip(all.map((f) => ({ name: `${meta.name}/${f.name}`, data: f.data })))
  const fileName = `${meta.name}-${meta.version}.dsh-plugin.zip`
  const zipPath = path.join(tmpDir, `${crypto.randomUUID()}-${fileName}`)
  await fs.promises.writeFile(zipPath, buffer)
  return { zipPath, fileName, meta, manifest, installMd, size: buffer.length, temps: [zipPath] }
}

/** 人类可读体积。 */
export function humanSize(n) {
  return n < 1024 ? `${n} B`
    : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB`
    : n < 1024 * 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 把"路径或已安装插件名"解析成插件目录(只读,不改 profile)。 */
export async function resolvePluginDir(input, { dshProfileDir } = {}) {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('plugin is required: a directory path or an installed plugin name')
  const st = await fs.promises.stat(raw).catch(() => null)
  if (st?.isDirectory()) return path.resolve(raw)
  const profileDir = dshProfileDir
    || process.env.DSH_PROFILE_DIR
    || path.join(os.homedir(), '.dsh')
  const candidates = [
    path.join(profileDir, 'profiles', 'web', 'node_modules', raw),
    path.join(profileDir, 'profiles', 'desktop', 'node_modules', raw),
    path.join(profileDir, 'profiles', 'web', 'node_modules', '@deepseek-ai', raw),
  ]
  for (const c of candidates) {
    const s = await fs.promises.stat(c).catch(() => null)
    if (s?.isDirectory() && fs.existsSync(path.join(c, 'package.json'))) return c
  }
  throw new Error(`plugin not found: "${raw}" (tried as path and under ${profileDir}/profiles/*/node_modules)`)
}
