// lib/tools/send.js — localsend_send_files:把文件/文件夹经 LocalSend v2 上传协议发到目标机器。
// 目录会被自动打包成临时 zip 再发送,接收端收到的是 <文件夹名>.zip。
import os from 'node:os'
import path from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { DEFAULT_PORT, TOOL_TIMEOUT_MS } from '../constants.js'
import { resolveTarget } from '../discovery.js'
import { cleanupTemps, resolveSendTargets } from '../pack.js'
import { sendFiles } from '../transfer.js'

function textOut(v) {
  return String(v)
}

export function defineSendFilesTool(getConfig) {
  return defineTool({
    name: 'localsend_send_files',
    description:
      'Send local files or folders over the LAN to a machine running LocalSend. The target can be an IP ' +
      '(e.g. 192.168.1.50) or a device alias shown in LocalSend (matched by scanning the LAN). Each entry in files ' +
      'may be a single file (sent as-is) or a folder (packed into <folder-name>.zip automatically, then that zip is ' +
      'sent). The receiver machine must be online and will be prompted to accept the transfer; sending blocks until ' +
      'the receiver accepts or the acceptTimeoutMs passes. Only transfer paths the user explicitly asked to send to a ' +
      'machine the user explicitly named.',
    parameters: {
      target: { type: 'string', description: 'Target machine: LocalSend alias (e.g. 黄夫人) or IPv4 address.' },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute paths to send. Files are sent as-is; directories are packed to <name>.zip first.',
      },
      port: { type: 'number', description: `Target LocalSend port (default ${DEFAULT_PORT}).` },
      acceptTimeoutMs: { type: 'number', description: 'How long to wait for the receiver to accept, in ms (default 240000).' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const cfg = getConfig()
      const port = Number(args.port || cfg.port || DEFAULT_PORT)
      const logs = []
      const log = (s) => logs.push(s)

      const target = String(args.target ?? '').trim()
      if (!target) throw new Error('target is required (alias or IP)')
      const inputs = (Array.isArray(args.files) ? args.files.map((f) => String(f)) : []).map((f) =>
        path.isAbsolute(f) ? f : path.resolve(f))
      if (inputs.length === 0) throw new Error('files is required: at least one existing file or folder path')

      // 解析目标:文件直发,目录自动打包(临时 zip,结束后清理)。
      const { targets, temps, notes } = await resolveSendTargets(inputs, {
        maxFileBytes: cfg.maxFileBytes,
        tmpDir: os.tmpdir(),
        onSkip: (m) => log(`note: ${m}`),
      })
      for (const n of notes) log(`note: ${n}`)
      const sendPaths = targets.map((t) => t.sendPath)

      try {
        // 目标解析(别名→扫描局域网;IP 直连)。
        const tgt = await resolveTarget(target, { port, timeoutMs: cfg.scanTimeoutMs, signal: exec.signal })
        for (const n of tgt.notes) log(`note: ${n}`)
        if (tgt.device) log(`target ${JSON.stringify(tgt.device.alias)} @ ${tgt.ip} (LocalSend ${tgt.device.version})`)
        else log(`target ${target} @ ${tgt.ip}`)

        log('transfer in progress: if the receiver does not auto-accept, someone must click 接受/accept on the target machine.')
        const out = await sendFiles({
          ip: tgt.ip,
          port,
          alias: cfg.alias,
          files: sendPaths,
          protocol: 'https',
          maxFileBytes: cfg.maxFileBytes,
          prepareTimeoutMs: cfg.acceptTimeoutMs,
          uploadTimeoutMs: cfg.uploadTimeoutMs,
          onLog: log,
          signal: exec.signal,
        })
        log(`sent ${out.results.length} file(s) in session ${out.sessionId ?? '-'}`)
        return logs.join('\n')
      } finally {
        await cleanupTemps(temps)
      }
    },
  })
}
