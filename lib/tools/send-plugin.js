// lib/tools/send-plugin.js — localsend_send_plugin 工具:薄组合层。
// 打包/清单/解析逻辑都在 lib/plugin-pack.js(可独立测试,不依赖 dsh-tools);
// 这里只做:参数解析 → packPlugin → createShareSession → 结构化输出。
import fs from 'node:fs'
import os from 'node:os'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { TOOL_TIMEOUT_MS } from '../constants.js'
import { humanSize, packPlugin, resolvePluginDir } from '../plugin-pack.js'
import { createShareSession } from '../share.js'

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
