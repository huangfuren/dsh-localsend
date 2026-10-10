// lib/tools/smb.js — localsend_smb_push:把文件/文件夹经 SMB 共享复制到目标机器指定目录。
// 通道定位:接收方不装任何软件,只需预先开一个共享文件夹并给发送方账户读写权限。满足
// "无软件 + 指定 IP + 指定落盘目录 + 全自动" 诉求。目录会被自动打包成临时 zip 再复制。
// 目标机可来自 settings 里的 smbProfiles 档案(profile=<名>),显式参数逐字段覆盖档案。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { TOOL_TIMEOUT_MS, MAX_FILE_BYTES } from '../constants.js'
import { resolveSendTargets, cleanupTemps } from '../pack.js'
import { buildTargetDir, mountShare, unmountShare, copyToTarget, findProfile, mergeProfile } from '../smb.js'

// render 必须返回 ContentBlock[]（dsh 契约），裸字符串会写坏 tool/result 事件。
function textOut(v) {
  return [{ type: 'text', text: String(v) }]
}

export function defineSmbPushTool(getConfig) {
  return defineTool({
    name: 'localsend_smb_push',
    description:
      'Push local files or folders to a specific directory on another machine over the LAN via an SMB ' +
      'file share — NO software is required on the receiver (the receiver only needs to have shared a ' +
      'folder in advance and granted the sender read/write access). You specify the target machine IP, ' +
      'the share name, the destination sub-directory, and the files. The copy is fully automatic (no ' +
      'click on the receiver). Folders are auto-packed into a <name>.zip before transfer; files are copied as-is. ' +
      'Preferred: if the user has saved a target profile in the settings card, pass profile="<name>" plus ' +
      'files only — the profile supplies target/share/destDir/credentials. Any explicit argument overrides ' +
      'the matching profile field. If no profile is used, target and share are required. ' +
      'Requires the target folder to be shared (Windows share) with write permission for the sender account. ' +
      'Only push paths the user explicitly asked to send to a machine the user explicitly named.',
    parameters: {
      profile: { type: 'string', description: 'Name of a saved target profile (from the plugin settings card). When set, target/share/destDir/username/password default to that profile; explicit args below override individual fields.' },
      target: { type: 'string', description: 'Target machine: IP address (e.g. 192.0.2.10) or hostname (e.g. TARGET-PC). Required unless a profile supplies it.' },
      share: { type: 'string', description: 'Shared folder name on the target machine (e.g. 共享文件夹 or recv; C$ = admin share). Required unless a profile supplies it.' },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute paths to push. Files copied as-is; directories auto-packed to <name>.zip first.',
      },
      destDir: { type: 'string', description: 'Sub-directory under the share to place files in (optional; empty = share root or the profile value).' },
      username: { type: 'string', description: 'Optional SMB account on the target (e.g. TARGET-PC\\user). Empty = profile value, else guest/anonymous.' },
      password: { type: 'string', description: 'Optional password for username. NOTE: this is the Windows/Microsoft account password, NOT a PIN. Empty = profile value.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const cfg = getConfig()
      const logs = []
      const log = (s) => logs.push(s)

      // 档案优先、显式参数覆盖：profile=<名> 时先从 settings 里取出目标机信息，再让显式参数逐字段覆盖。
      const profileName = String(args.profile ?? '').trim()
      const profiles = Array.isArray(cfg.smbProfiles) ? cfg.smbProfiles : []
      const profile = findProfile(profiles, profileName)
      const resolved = mergeProfile(profile, args)
      if (profile) log(`using profile "${profileName}"`)

      const target = resolved.host
      const share = resolved.share
      if (!target) throw new Error('target (IP/hostname) is required: pass target=<ip|host>, or use profile="<name>" whose host is set')
      if (!share) throw new Error('share (shared folder name on target) is required: pass share=<name>, or set it in the profile')
      const inputs = (Array.isArray(args.files) ? args.files.map((f) => String(f)) : []).map((f) =>
        path.isAbsolute(f) ? f : path.resolve(f))
      if (inputs.length === 0) throw new Error('files is required: at least one existing file or folder path')

      const destDir = buildTargetDir(target, share, resolved.destDir || '')
      log(`target dir: ${destDir}`)

      // 解析文件:目录自动打包(共享通道下也走 zip,传输更稳)
      const { targets, temps, notes } = await resolveSendTargets(inputs, {
        maxFileBytes: cfg.maxFileBytes || MAX_FILE_BYTES,
        tmpDir: os.tmpdir(),
        onSkip: (m) => log(`note: ${m}`),
      })
      for (const n of notes) log(`note: ${n}`)
      const sendPaths = targets.map((t) => t.sendPath)

      let mounted = false
      try {
        log('mounting SMB share ...')
        const m = await mountShare(destDir, {
          username: resolved.username,
          password: resolved.password,
          timeoutMs: 30_000,
        })
        mounted = true
        log(m.usedGuest ? 'mounted as guest (no credentials)' : 'mounted with provided credentials')

        for (const src of sendPaths) {
          const st = fs.statSync(src)
          const leaf = st.isDirectory() ? path.basename(src) : path.basename(src)
          log(`copying "${leaf}" -> ${destDir}\\${leaf} ...`)
          const r = await copyToTarget(destDir, src, { timeoutMs: 120_000 })
          log(`OK "${leaf}" (robocopy exit ${r.exitCode})`)
        }
        log(`\n✅ pushed ${sendPaths.length} item(s) to ${destDir}`)
        return logs.join('\n')
      } catch (err) {
        log(`\n❌ SMB push failed: ${err.message}`)
        throw err
      } finally {
        if (mounted) await unmountShare(destDir)
        await cleanupTemps(temps)
      }
    },
  })
}
