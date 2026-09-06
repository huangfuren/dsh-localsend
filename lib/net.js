// lib/net.js — 极简 http/https 客户端(自签名放行)与并发池。零依赖。
import http from 'node:http'
import https from 'node:https'

/**
 * 发一次请求,返回 { status, text }。
 * @param {object} o
 * @param {'http'|'https'} o.protocol
 * @param {string} o.host
 * @param {number} o.port
 * @param {string} o.path
 * @param {string} [o.method]
 * @param {object} [o.headers]
 * @param {Buffer|string} [o.body]
 * @param {number} [o.timeoutMs]
 */
export function request({
  protocol = 'https', host, port, path, method = 'GET',
  headers = {}, body, timeoutMs = 15_000, signal,
}) {
  return new Promise((resolve, reject) => {
    const mod = protocol === 'http' ? http : https
    const req = mod.request(
      {
        host, port, path, method, timeout: timeoutMs,
        rejectUnauthorized: false, // LocalSend 使用自签名证书
        headers: Object.assign({ 'User-Agent': 'dsh-localsend' }, headers),
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', (e) => reject(new Error(`network error: ${e.message}`)))
    req.on('timeout', () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)) })
    if (signal) {
      if (signal.aborted) req.destroy(new Error('aborted'))
      else signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
    }
    if (body !== undefined && body !== null) req.write(body)
    req.end()
  })
}

/** 简单并发池:items 交给 worker,最多 concurrency 个并发。 */
export async function runPool(items, concurrency, worker) {
  const out = new Array(items.length)
  let i = 0
  async function next() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await worker(items[idx], idx)
    }
  }
  const runners = []
  for (let k = 0; k < concurrency; k++) runners.push(next())
  await Promise.all(runners)
  return out
}
