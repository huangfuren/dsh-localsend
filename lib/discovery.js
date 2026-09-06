// lib/discovery.js — 本机子网推导 + 逐 IP 探测 LocalSend(info) + 目标解析。零依赖。
import os from 'node:os'

import { DEFAULT_PORT, IPV4_PATTERN, SCAN_CONCURRENCY, SCAN_TIMEOUT_MS } from './constants.js'
import { request, runPool } from './net.js'

function ipToInt(ip) {
  return ip.split('.').reduce((acc, p) => (acc << 8) | Number(p), 0) >>> 0
}
function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}
function maskToInt(mask) {
  return mask.split('.').reduce((acc, p) => (acc << 8) | Number(p), 0) >>> 0
}
function maskPrefix(maskInt) {
  // 连续掩码:统计最高位起连续的 1 的个数。
  let m = maskInt >>> 0
  let prefix = 0
  while ((m & 0x80000000) !== 0) {
    prefix += 1
    m = (m << 1) >>> 0
  }
  return prefix
}

/** 由网卡信息推导子网:{ baseInt, prefix, selfIp, networkBase, broadcast, hosts }。 */
export function computeSubnet(address, netmask) {
  const addrInt = ipToInt(address)
  const maskInt = maskToInt(netmask)
  const prefix = maskPrefix(maskInt)
  const baseInt = (addrInt & maskInt) >>> 0
  const broadcast = (baseInt | (~maskInt)) >>> 0
  return {
    selfIp: address,
    networkBase: intToIp(baseInt),
    broadcast: intToIp(broadcast),
    prefix,
    baseInt,
    broadcastInt: broadcast,
    // 仅支持 /24 及更小的常规局域网;更宽网段按主机位截断,避免超大扫描。
    maxScanHosts: 254,
  }
}

/** 解析 '192.168.1.0/24' 形式的 CIDR。 */
export function parseCidr(cidr) {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/.exec(String(cidr).trim())
  if (!m) throw new Error(`invalid CIDR: ${cidr}`)
  const prefix = Number(m[2])
  if (prefix < 16 || prefix > 30) throw new Error(`CIDR prefix out of supported range (16-30): ${cidr}`)
  const addrInt = ipToInt(m[1])
  const maskInt = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  const baseInt = (addrInt & maskInt) >>> 0
  return {
    networkBase: intToIp(baseInt),
    prefix,
    baseInt,
    maxScanHosts: 254,
  }
}

/** 本机活动 IPv4 网卡子网列表(跳过虚拟/内部地址)。 */
export function getLocalSubnets() {
  const found = []
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      // 跳过常见虚拟网卡/隧道网段,避免扫 Docker/WSL 等无意义段。
      const first = a.address.split('.')[0]
      if (first === '169') continue
      try {
        const s = computeSubnet(a.address, a.netmask)
        if (found.some((x) => x.selfIp === s.selfIp)) continue
        found.push(s)
      } catch { /* 忽略无法解析的网卡 */ }
    }
  }
  return found
}

async function probeInfo({ protocol = 'https', host, port, timeoutMs, signal }) {
  try {
    const r = await request({
      protocol, host, port,
      path: '/api/localsend/v2/info', timeoutMs, signal,
    })
    if (r.status !== 200) return null
    let info = null
    try { info = JSON.parse(r.text) } catch { return null }
    return {
      ip: host,
      alias: info.alias ?? '?',
      version: info.version ?? '?',
      deviceModel: info.deviceModel ?? '',
      deviceType: info.deviceType ?? '',
      protocol,
    }
  } catch {
    return null
  }
}

/**
 * 扫描一个子网内的 LocalSend 设备。
 * @param {object} o
 * @param {{baseInt:number,selfIp:string,broadcastInt:number,maxScanHosts:number}|{networkBase:string,prefix:number,baseInt:number,maxScanHosts:number}} o.subnet
 */
export async function scanSubnet({ subnet, port = DEFAULT_PORT, protocol = 'https', timeoutMs = SCAN_TIMEOUT_MS, skipIps = [], signal } = {}) {
  if (!subnet || subnet.baseInt === undefined) throw new Error('scanSubnet: subnet required')
  const selfInt = subnet.selfIp ? ipToInt(subnet.selfIp) : -1
  const skip = new Set([selfInt, subnet.broadcastInt ?? -1, ...skipIps.map(ipToInt)])
  const hosts = []
  for (let i = 1; i <= subnet.maxScanHosts; i++) {
    const hostInt = ((subnet.baseInt >>> 0) + i) >>> 0
    if (skip.has(hostInt)) continue
    hosts.push(intToIp(hostInt))
  }
  const results = await runPool(hosts, SCAN_CONCURRENCY, (ip) => probeInfo({ protocol, host: ip, port, timeoutMs, signal }))
  return results.filter(Boolean)
}

function isIp(input) {
  return IPV4_PATTERN.test(String(input).trim())
}

/**
 * 把"别名或 IP"解析为可发送的目标。
 * @returns {Promise<{ip:string, device?:object, match:string, notes:string[]}>}
 */
export async function resolveTarget(input, { port = DEFAULT_PORT, protocol = 'https', timeoutMs = SCAN_TIMEOUT_MS, signal } = {}) {
  const raw = String(input ?? '').trim()
  const notes = []
  if (!raw) throw new Error('target is empty: provide an IP or a LocalSend device alias')
  if (isIp(raw)) return { ip: raw, match: 'ip', notes: [] }

  const subnets = getLocalSubnets()
  if (subnets.length === 0) throw new Error('no active IPv4 LAN interface found on this host')
  const all = []
  for (const s of subnets) {
    const devs = await scanSubnet({ subnet: s, port, protocol, timeoutMs, signal })
    all.push(...devs)
  }
  if (all.length === 0) throw new Error(`no LocalSend device found on LAN (searched ${subnets.map((s) => s.networkBase).join(', ')}); start LocalSend on the target machine and retry`)
  const exact = all.filter((d) => String(d.alias).trim().toLowerCase() === raw.toLowerCase())
  if (exact.length === 1) return { ip: exact[0].ip, device: exact[0], match: 'exact', notes }
  if (exact.length > 1) {
    notes.push(`alias ${JSON.stringify(raw)} matched ${exact.length} devices; used the first one`)
    return { ip: exact[0].ip, device: exact[0], match: 'exact-multiple', notes }
  }
  const fuzzy = all.filter((d) => String(d.alias).toLowerCase().includes(raw.toLowerCase()))
  if (fuzzy.length === 1) {
    notes.push(`no exact alias match; fuzzy-matched ${JSON.stringify(fuzzy[0].alias)}`)
    return { ip: fuzzy[0].ip, device: fuzzy[0], match: 'fuzzy', notes }
  }
  if (fuzzy.length > 1) notes.push(`fuzzy matched ${fuzzy.length} aliases: ${fuzzy.map((d) => d.alias).join(', ')}`)
  throw new Error(`alias ${JSON.stringify(raw)} not found on LAN. Devices seen: ${all.map((d) => `${d.alias}@${d.ip}`).join(', ') || '(none)'}`)
}
