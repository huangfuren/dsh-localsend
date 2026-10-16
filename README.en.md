# dsh-localsend

English | [中文](README.md)

LAN file/folder transfer plus browser download-link sharing: let DeepSeek Harness send files (or **folders, auto-packed into a zip**) over the conversation to any machine on the same LAN running [LocalSend](https://github.com/localsend/localsend), or **generate a browser download link** (the receiver installs nothing).

Zero configuration by default — the LocalSend and share channels need no credentials, there are no third-party runtime dependencies and no hard-coded paths — it detects the local NIC subnet automatically and uses the hostname as the sender alias, so it works **the moment it is installed**. Ships host tools (for the agent) and a browser settings card (for the UI).

> Current version: **0.5.0**. Compatible with DeepSeek Harness **0.1.x** and **0.2.0-rc.1** (peer range `>=0.1.0-rc.6 <1.0.0`); Node.js ≥ 22.19; supports Windows / macOS / Linux.

## How it works

### LocalSend mode (`localsend_send_files`)

LocalSend has no official CLI, but every LocalSend receiver is a standard HTTP(S) service (default TCP **53317**, self-signed certificate) speaking the public [LocalSend Protocol v2](https://github.com/localsend/protocol). This plugin implements the **sender**:

1. Discover: probe `GET /api/localsend/v2/info` within the active subnet (read-only), matching by alias or IP;
2. Negotiate: `POST /api/localsend/v2/prepare-upload` submits metadata (name/size/type/sha256) — the receiver pops a dialog for the user to **accept**;
3. Upload: `POST /api/localsend/v2/upload` sends the raw bytes; the receiver verifies by sha256.

Directories need no manual packing: a built-in **zero-dependency zip writer** packs a folder into `<folder>.zip` before sending and cleans up the temporary archive afterwards.

### Share mode (`localsend_share`)

**The receiver installs nothing.** The plugin starts a temporary HTTP server on this machine and produces a one-shot download link:

1. Directories are auto-packed into a zip; small files (≤64 MB) get a sha256;
2. A URL with a random token is generated — the receiver opens it in any browser and downloads;
3. Once every file has been downloaded, or the link expires, the server shuts itself down.

Optional password protection (HTTP Basic Auth) and configurable port / lifetime are supported.

### SMB push mode (`localsend_smb_push`)

When **the receiver installs nothing at all**, push files/folders over an SMB share **automatically** into a **specific directory** on the target machine: `target` (IP/hostname) + `share` (share name) + `destDir` (subdirectory under the share; empty = share root) + `files`; `username`/`password` optional (anonymous = guest). Directories are auto-packed into a zip before copy. Prerequisite: the receiver pre-creates a share and grants the sender write access. This is the only workable channel for "no software + specific IP + specific destination directory + fully automatic" (the LocalSend channel forces the receiver to install the app; the browser-link channel cannot name a destination directory).

**Target profiles (recommended)** — save one profile per target machine in the settings card (name / target IP / share / sub-directory / account / password). Afterwards a call only needs `profile="书房台式机"` plus `files`; the profile supplies everything else, and any explicit argument overrides the matching field. That turns "push this local folder to the desktop of that machine" from "retype five parameters every time" into "configure once + one command". To land on the desktop, use `share="C$"` + `destDir="Users\<user>\Desktop"` (`C$` is the admin share, present by default on Windows).

> Boundary: a profile only stores **how to reach** the channel; it cannot create one. The receiver still needs a **one-time** access channel — the admin share `C$` exists by default (if the target account is a Microsoft account and not the built-in Administrator, set `LocalAccountTokenFilterPolicy=1` once), or a custom share with write access for the sender. After that, every push needs **zero action** on the receiver.

## Features

- **Five tools**:
  - `localsend_list_devices` — scan the LAN and list LocalSend devices (ip / alias / protocol version / device type); optional `subnet` (CIDR) to scope the scan;
  - `localsend_send_files` — send files/folders to a named target (alias auto-resolved, or IP); directories auto-packed; **probes the target first, so a wrong IP fails in seconds with next steps instead of waiting out the accept timeout**; blocks until the receiver accepts, then uploads, returning per-file results;
  - `localsend_share` — generate a temporary LAN HTTP download link; the receiver just opens it in a browser, no software needed; supports password protection; the server closes after download; output is a structured object (url / per-file size / total size / expiry / whether password-protected / log);
  - `localsend_send_plugin` — pack a DSH plugin directory into a self-contained distribution zip (excludes `node_modules`/`.git`; contains a `dsh-plugin.manifest.json` manifest + `INSTALL.md` card) and share it over a temporary HTTP link; **the receiver needs only a browser**, no LocalSend or any software, then unzips and runs one install command from `INSTALL.md`. The `plugin` argument accepts an absolute directory path or an installed plugin name (resolved read-only under `~/.dsh/profiles/*/node_modules`; distributing dsh-localsend itself is just `plugin="dsh-localsend"`);
  - `localsend_smb_push` — see "SMB push mode" above.
- **Mixed files and folders**: one list may hold both files and directories; each directory is packed into its own zip.
- **GUI settings card**: the "LocalSend LAN transfer" card under Settings → plugin configuration, editing alias / port / timeouts / max file size / share port / expiry / password, and adding/removing **target profiles** (including credentials); saving takes effect immediately (for new sessions' tool calls).
- **Robustness**: duplicate/ambiguous aliases are flagged; error codes (403 refused, 409 busy, 429 rate-limited, 422 verification failed, …) map to readable text; failures cancel the session; symlinks and empty directories are skipped; the per-file/per-package cap defaults to 1 GiB (configurable).
- **Secure by default**: LAN only; scans are read-only; the sender alias defaults to the hostname; the receiver's manual "accept" is the authorization gate; self-signed HTTPS + end-to-end sha256; the share link is one-shot (random token).
- **Works out of the box / distributable**: no build step (`index.js`/`client.js` are the artifacts), no machine-local path residue; installable via `dsh plugin`, `npm pack`, or a manual link.

## Installation

### Recommended: DSH-managed install (published on GitHub)

```bash
dsh plugin --profile web add git+https://github.com/huangfuren/dsh-localsend.git#v0.5.0
```

`#v0.5.0` pins that release; drop the suffix to track the latest commit on `main`. After installing, **restart DSH**: new sessions gain the five tools, and after the GUI refreshes the card appears under Settings → plugin configuration.

### Local / offline install

1. Put the `dsh-localsend` directory into your plugin folder (e.g. `dsh-plugin\`);
2. Add `"dsh-localsend": "file:<path>"` (or `link:<absolute path>`) to the profile's `package.json` `dependencies`, and add `dsh-localsend` to `dsh.profile.bundles`;
3. Or run `npm pack` on the directory and, in the profile directory, `npm/pnpm install <dsh-localsend-0.5.0.tgz>` (network needed to resolve peers);
4. Restart DSH.

## Configuration (GUI card / settings namespace `localsend`)

| Key | Default | Description |
|---|---|---|
| `alias` | auto (hostname) | Sender alias seen by the receiver |
| `port` | 53317 | Target LocalSend port |
| `scanTimeoutMs` | 1500 | Per-IP probe timeout (ms) |
| `acceptTimeoutMs` | 240000 | Wait for the receiver to accept (ms) |
| `uploadTimeoutMs` | 120000 | Per-file upload timeout (ms) |
| `maxFileBytes` | 1073741824 (1 GiB) | Per-file/per-zip size cap (bytes); folders are zipped in a streaming pass, so memory tracks the largest single file rather than the folder total |
| `sharePort` | 0 | Share server port (0 = random) |
| `shareExpiresIn` | 3600 | Share link lifetime (seconds), 0 = no expiry |
| `sharePassword` | "" | Share download password (empty = none) |
| `smbProfiles` | `[]` | Array of target profiles, each `{name, host, share, destDir, username, password}`; once saved, `localsend_smb_push` only needs `profile="<name>"` (credentials are stored in plain text — see Security notes) |
| `dshProfileDir` | `~/.dsh` | DSH home used to resolve installed plugins by name (read-only) |

All keys may be left default; empty means the built-in default.

`sharePort` / `shareExpiresIn` / `sharePassword` also act as the defaults for the matching tool
arguments of `localsend_share` and `localsend_send_plugin`: omit an argument and the setting applies,
pass it explicitly and the argument wins (including `expiresIn=0` for "no expiry" and `password=""`
for "no password this time").

## Examples

### LocalSend mode

> Pack the `D:\资料\报告` folder and send it to 黄夫人
> Send `C:\tmp\a.pdf` and `D:\photos` to 192.168.1.50

The tool resolves the target (exact/ambiguous alias match or IP) → packs directories into a zip → asks the receiver to accept → uploads → reports per-file results. If the receiver has not enabled auto-accept, someone must tap "accept" in their LocalSend.

### Share mode

> Share `D:\资料\报告.pdf` with a colleague
> Generate a download link with password 1234

The tool generates a temporary HTTP download link; the receiver opens it in a browser and downloads — no software needed.

### SMB push

> Push `D:\打包\bundle` to the dsh-sync directory under the "共享文件夹" share on 10.0.0.30
> Push `D:\打包\bundle` to the desktop of "书房台式机"

The tool packs the directory and copies it automatically into the named directory of the target share, with no "accept" on the receiving side, provided the receiver has opened the share and granted write access. The second example uses a **target profile**: configure "书房台式机" once as `C$` + `Users\<user>\Desktop`, then every later push is a single sentence.

## Security notes

- LAN only; the scan never leaves the local active subnet or crosses a gateway.
- Probes are read-only (`info`); a send must be "a target the user named explicitly + files/folders the user named explicitly".
- The receiver must tap "accept" by default (or has auto-accept on); the protocol has no shared secret, so the dialog is the authorization gate.
- The sender only holds file contents; it reads and stores no credentials, and treats every receiver response as untrusted data.
- **Exception — SMB target profiles**: if you save profiles in the settings card, their credentials (including the password) are stored in **plain text** in the local DSH settings file and travel with it whenever it is synced or backed up. This is a deliberate trade-off for pushing between your own machines — **do not enable it on a shared or multi-user machine**.
- LAN transfer uses self-signed HTTPS; a sha256 mismatch (HTTP 422) surfaces a clear error.
- The share link is a one-shot random token; the server closes after download; password protection is optional.

## Development and testing

```bash
npm run check   # node --check on every entry point
npm test        # unit tests + a local mock-receiver end-to-end (zip packing, upload, 422 mismatch, cancel), no network
npm run verify
```

Coverage: zip write/parse round-trip, CRC-32, directory packing and cleanup, mock end-to-end "directory → auto zip → upload", sha256 mismatch 422, session cancel, SMB UNC building with `net use`/`robocopy` arguments (including a regression case asserting the target appears exactly once), and target-profile resolution (`findProfile` lookup/error, `mergeProfile`'s "explicit args override the profile").

## Compatibility notes

- The peer range is deliberately wide (`>=0.1.0-rc.6 <1.0.0`); both the dsh 0.1.x line and 0.2.0-rc.1 resolve.
- Verified against the host's `ctx.tools/systemPrompt/settings` and the client's keyed slot and `dsh.client.inject`.
- Anything outside that range is uncertified.

## Release

- Repository: https://github.com/huangfuren/dsh-localsend
- Suggested flow: pass all tests (`npm run verify`) → `npm pack` → tag a GitHub Release (attach the tarball).

## License

[MIT](./LICENSE)
