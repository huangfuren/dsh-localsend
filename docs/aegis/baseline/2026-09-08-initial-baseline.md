# Baseline — dsh-localsend @ v0.2.0

- Repo: https://github.com/huangfuren/dsh-localsend (author huangfuren, MIT)
- Runtime: Node.js ≥ 22.19, zero-dep lib/ (no third-party runtime deps except `@deepseek-ai/schemastery`)
- Transport (LocalSend App protocol): lib/protocol.js + lib/transfer.js + lib/net.js — push-only (`prepare-upload`/`upload`), whole-file-in-memory, 1 GiB cap
- Zero-requirement transport: lib/share.js — one-time HTTP link, browser download, Range resume, password, auto-close
- Discovery: lib/discovery.js — subnet sweep (≤ /24, 254 hosts, 48 concurrency), no mDNS
- Packaging: lib/pack.js + lib/zip.js — dir → `<name>.zip` (zero-dep zip writer, store/deflate, UTF-8 names)
- Tools (3): `localsend_list_devices`, `localsend_send_files`, `localsend_share`
- Install model: `dsh plugin --profile web add link:<dir>` (profile pnpm-links it; receiver installs deps itself)
- Tests: `node --test test/` (unit / zip / mock e2e), `npm run verify` = `npm run check && npm test`
