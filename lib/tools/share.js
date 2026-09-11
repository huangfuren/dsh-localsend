// lib/tools/share.js — localsend_share:生成临时 HTTP 下载链接,接收方用浏览器打开即可下载。
// 不需要接收方安装任何软件,同一局域网内打开链接就能下载文件。
import path from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { TOOL_TIMEOUT_MS } from '../constants.js'
import { resolveSendTargets, cleanupTemps } from '../pack.js'
import { getLocalIp, createShareSession } from '../share.js'

export function defineShareTool(getConfig) {
  return defineTool({
    name: 'localsend_share',
    description:
      'Generate a temporary HTTP download link for local files. The receiver does NOT need ' +
      'LocalSend or any software — just open the URL in any browser on the same LAN to download. ' +
      'The link is one-time: the server shuts down automatically after all files are downloaded or when ' +
      'the expiry time is reached. Folders are auto-packed into zip before sharing. Only share files ' +
      'the user explicitly asked to share.',
    parameters: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute paths to share. Files are shared as-is; directories are packed to <name>.zip first.',
      },
      password: { type: 'string', description: 'Optional download password. Empty = no password.' },
      expiresIn: {
        type: 'number',
        description: 'Link validity period in seconds (default 3600 = 1 hour). 0 = no expiry (server closes after all downloads).',
      },
      port: { type: 'number', description: 'Listen port (default 0 = random available port).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string' }, size: { type: 'number' } },
              required: ['name', 'size'],
            },
          },
          totalSize: { type: 'number' },
          expiresIn: { type: 'number' },
          password: { type: 'boolean' },
          log: { type: 'string' },
        },
        required: ['url', 'files', 'totalSize', 'expiresIn', 'password', 'log'],
      },
      render: (_args, v) => [{ type: 'text', text: v.log }],
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const cfg = getConfig()
      const logs = []
      const log = (s) => logs.push(s)

      const inputs = (Array.isArray(args.files) ? args.files.map((f) => String(f)) : []).map((f) =>
        path.isAbsolute(f) ? f : path.resolve(f))
      if (inputs.length === 0) throw new Error('files is required: at least one existing file or folder path')

      const password = String(args.password || '').trim()
      const expiresIn = Math.max(0, Number(args.expiresIn ?? 3600) || 3600)
      const port = Number(args.port ?? 0) || 0

      // 解析文件:目录自动打包
      const { targets, temps, notes } = await resolveSendTargets(inputs, {
        maxFileBytes: cfg.maxFileBytes,
        onSkip: (m) => log(`note: ${m}`),
      })
      for (const n of notes) log(`note: ${n}`)
      const sendPaths = targets.map((t) => t.sendPath)

      try {
        const session = await createShareSession({
          files: sendPaths,
          alias: cfg.alias || `dsh-localsend (${getLocalIp()})`,
          password,
          expiresIn,
          port,
          onLog: log,
          signal: exec.signal,
        })

        log(`\n✅ 分享链接已生成，接收方在浏览器打开即可下载：`)
        log(`\n   ${session.url}\n`)
        if (password) log('   🔒 需要密码')
        log(`   ⏱ 链接有效期: ${expiresIn > 0 ? `${expiresIn} 秒` : '无限期（下载完自动关闭）'}`)
        log(`   📦 文件数: ${session.files.length}`)
        const totalSize = session.files.reduce((s, f) => s + f.size, 0)
        log(`   📏 总大小: ${totalSize < 1024 * 1024 ? `${(totalSize / 1024).toFixed(1)} KB` : totalSize < 1024 * 1024 * 1024 ? `${(totalSize / (1024 * 1024)).toFixed(1)} MB` : `${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`}`)
        const shareFiles = session.files.map((f) => ({ name: f.name, size: f.size }))
        for (const f of session.files) {
          log(`   - ${f.name} (${f.size} B)`)
        }
        log(`\n⏳ 等待下载完成...（下载完成后服务器自动关闭）`)

        // 等待下载完成或信号取消
        await new Promise((resolve) => {
          session.onDone = (reason) => {
            log(`\n✅ 分享结束: ${reason}`)
            log(`   已下载: ${session.downloaded.size}/${session.files.length} 个文件`)
            log(`   总传输: ${session.totalDownloaded} B`)
            resolve()
          }
          if (exec.signal) exec.signal.addEventListener('abort', () => resolve(), { once: true })
        })

        return {
          url: session.url,
          files: shareFiles,
          totalSize,
          expiresIn,
          password: Boolean(password),
          log: logs.join('\n'),
        }
      } finally {
        await cleanupTemps(temps)
      }
    },
  })
}
