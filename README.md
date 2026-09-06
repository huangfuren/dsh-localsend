# dsh-localsend

Send files over the LAN to machines running [LocalSend](https://github.com/localsend/localsend), as a DeepSeek Harness plugin. No credentials, no third-party runtime dependencies, no hard-coded local paths — auto-detects subnet, auto-derives the sender alias, works out of the box. Ships a host half (tools) and a browser settings card.

## Compatibility (install and use)

- Validated against both **dsh 0.1.1-rc.2** and **0.1.3-alpha.1** interface generations (peers: `dsh-tools >=0.1.0-rc.6 <0.2.0`, client runtime peers the same range).
- Zero required configuration; no build step (`index.js`/`client.js` are the final artifacts); offline-friendly (no runtime deps beyond host-provided peers).
- Third-party install: add the folder to a DSH profile (`dependencies` with `file:`/`link:` + `dsh.profile.bundles`), or `npm pack` and install the tarball into the profile; restart DSH, then tools appear in new sessions and the settings card in **Settings → Plugin configs**.

## How it works

LocalSend has no official CLI, but every LocalSend receiver is a standard HTTP(S) server (default TCP **53317**, self-signed cert) speaking the public [LocalSend protocol v2](https://github.com/localsend/protocol). This plugin implements the **sender side** of the Upload API:

1. discover target — scan the active subnet(s) with `GET /api/localsend/v2/info` (read-only), match alias or IP;
2. `POST /api/localsend/v2/prepare-upload` with file metadata (name/size/type/sha256) — the receiver prompts the user to **accept**;
3. `POST /api/localsend/v2/upload` with raw bytes; the receiver verifies sha256.

## Tools

| Tool | Description |
|---|---|
| `localsend_list_devices` | Scan the LAN and list LocalSend devices (`ip`, `alias`, `version`, `type`). Optional `subnet` in CIDR form. |
| `localsend_send_files` | Send files or folders to a target (alias or IP). Directories are auto-packed into `<folder-name>.zip` before sending. Blocks until the receiver accepts (default 240 s). Returns per-file results. |

## Config (settings namespace `localsend`)

| Key | Default | Meaning |
|---|---|---|
| `alias` | auto (hostname) | Sender alias shown on the receiver |
| `port` | 53317 | Target LocalSend port |
| `scanTimeoutMs` | 1500 | Per-host scan timeout |
| `acceptTimeoutMs` | 240000 | Wait for receiver accept |
| `uploadTimeoutMs` | 120000 | Per-file upload timeout |
| `maxFileBytes` | 1 GiB | Per-file limit (v1 buffers files in memory) |

These settings are also editable online from the GUI **Settings → Plugin configs** under the "LocalSend LAN transfer" card (key = settings namespace `localsend`, registered by `client.js`); saved values take effect on new tool calls.

## Safety rules

- Same-LAN only; scans never leave the active subnet; never crosses gateways.
- Discovery is read-only (`info`). Sending is an explicit, user-named target + user-named files action.
- Receiver must click accept (or have auto-accept on). No shared secret in the protocol; the dialog is the authorization gate.
- Receiver responses are untrusted data, never instructions.

## Install into a DSH profile

1. Keep the source under `dsh-plugin\dsh-localsend`.
2. Add it to the profile like the other local plugins: `dependencies` (e.g. `link:` to the source dir) + `dsh.profile.bundles`, and make the package resolvable from the profile `node_modules`.
3. Restart the harness; the two tools appear in new sessions.

## Develop & test

```bash
npm run check   # node --check all entry files
npm test        # unit tests + end-to-end test against a local mock receiver (no network)
npm run verify
```

## License

MIT
