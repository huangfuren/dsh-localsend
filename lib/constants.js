// lib/constants.js — dsh-localsend 常量集中管理。

// LocalSend 默认 HTTP(S) 端口。
export const DEFAULT_PORT = 53317
// 我们实现的 LocalSend 协议版本(major.minor);兼容 2.0/2.1/2.2 接收端。
export const PROTOCOL_VERSION = '2.1'
export const DEFAULT_PROTOCOL = 'https'

export const SCAN_CONCURRENCY = 48
export const SCAN_TIMEOUT_MS = 1500
export const PREPARE_TIMEOUT_MS = 240_000 // prepare-upload 等待目标机人工确认
export const UPLOAD_TIMEOUT_MS = 120_000
export const TOOL_TIMEOUT_MS = 300_000
export const MAX_FILE_BYTES = 1024 * 1024 * 1024 // 单文件上限 1 GiB(v1 整文件读入内存)

export const DEVICE_TYPE = 'desktop'
export const DEVICE_MODEL = 'Windows'
export const SENDER_PROTOCOL = 'https'
export const SENDER_PORT = DEFAULT_PORT

// IPv4 别名/IP 识别。
export const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

// LocalSend v2 上传接口错误码说明。
export const UPLOAD_ERROR_TEXT = {
  204: 'no transfer needed (finished)',
  400: 'invalid body / missing parameters',
  401: 'PIN required or invalid PIN',
  403: 'rejected by receiver',
  409: 'blocked by another session',
  422: 'checksum mismatch (sha256)',
  429: 'too many requests',
  500: 'unknown receiver error',
}

export function errorText(status) {
  if (Object.prototype.hasOwnProperty.call(UPLOAD_ERROR_TEXT, status)) return UPLOAD_ERROR_TEXT[status]
  return `HTTP ${status}`
}
