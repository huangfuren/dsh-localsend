// lib/tools/send-plugin.js — localsend_send_plugin 工具:薄组合层。
// 打包/清单/解析逻辑都在 lib/plugin-pack.js(可独立测试,不依赖 dsh-tools);
// 这里只做:参数解析 → packPlugin → createShareSession → 结构化输出。
import fs from 'node:fs'
import os from 'node:os'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { TOOL_TIMEOUT_MS } from '../constants.js'
import { humanSize, packPlugin, resolvePluginDir } from '../plugin-pack.js'
import { createShareSession, resolveShareOptions } from '../share.js'

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
          url: { type: 'string', required: true },
          plugin: { type: 'string', required: true },
          version: { type: 'string', required: true },
          zipName: { type: 'string', required: true },
          size: { type: 'number', required: true },
          installCommand: { type: 'string', required: true },
          log: { type: 'string', required: true },
        },
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

      // 显式参数优先，未提供时回落到设置项（sharePassword / shareExpiresIn / sharePort）。
      const { password, expiresIn, port } = resolveShareOptions(args, cfg)

      try {
        const session = await createShareSession({
          files: [packed.zipPath],
          alias: `${packed.meta.name} v${packed.meta.version} (dsh-localsend)`,
          password,
          expiresIn,
          port,
          // 临时 zip 交给会话持有:链接生成后服务器还要继续提供下载,不能在工具返回时就删。
          temps: packed.temps,
          onLog: log,
        })
        log('')
        log('✅ 插件包已就绪，接收方浏览器打开即可下载（无需安装任何软件）：')
        log(`   ${session.url}`)
        if (password) log('   🔒 需要密码')
        log(`   ⏱ 有效期: ${expiresIn > 0 ? `${expiresIn} 秒` : '下载完成自动关闭'}`)
        log(`   📦 ${packed.fileName} (${humanSize(packed.size)})`)
        log('')
        log('接收端安装（解压后执行）:')
        log(`   pnpm install --dir <解压目录>/${packed.meta.name}`)
        log(`   dsh plugin --profile web add link:<解压目录>/${packed.meta.name}`)
        log('   然后重启 dsh web')

        log('')
        log(`ℹ️  服务器已在后台运行${expiresIn > 0 ? `，${expiresIn} 秒后自动关闭` : ''}；下载完成后也会自动关闭。`)
        log('   链接指向本机内网地址:接收方需与本机在同一局域网(或经组网互通)才能访问。')

        return {
          url: session.url,
          plugin: packed.meta.name,
          version: packed.meta.version,
          zipName: packed.fileName,
          size: packed.size,
          installCommand: `dsh plugin --profile web add link:<解压目录>/${packed.meta.name}`,
          log: logs.join('\n'),
        }
      } catch (e) {
        // 会话没建立成功时兜底清理临时 zip(正常情况下由会话 shutdown 负责)。
        for (const t of packed.temps) { try { await fs.promises.unlink(t) } catch { /* 忽略 */ } }
        throw e
      }
    },
  })
}
