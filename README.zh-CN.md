# dsh-localsend

局域网内把文件发送到运行 [LocalSend](https://github.com/localsend/localsend) 的机器 —— DeepSeek Harness 插件。
无凭据、无第三方运行时依赖(仅用 Node 内置模块 + `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery` peer)。
包含 host 工具 + 浏览器设置卡片。

## 原理

LocalSend 没有官方 CLI,但每台接收端都是标准 HTTP(S) 服务(默认 TCP **53317**,自签名证书),
遵循公开协议 [LocalSend protocol v2](https://github.com/localsend/protocol)。本插件实现**发送端**:

1. 发现目标 —— 在活动子网内用 `GET /api/localsend/v2/info` 探测(只读),按别名或 IP 匹配;
2. `POST /api/localsend/v2/prepare-upload` 提交元信息(文件名/大小/类型/sha256)——接收端弹窗让用户**接受**;
3. `POST /api/localsend/v2/upload` 上传原始字节,接收端按 sha256 校验。

## 工具

| 工具 | 说明 |
|---|---|
| `localsend_list_devices` | 扫描局域网列出 LocalSend 设备(`ip`/`alias`/`version`/`type`);可选 `subnet`(CIDR) |
| `localsend_send_files` | 向目标(别名或 IP)发送文件/文件夹;目录自动打包成 `<文件夹名>.zip` 再发;阻塞等待接收端接受(默认 240 s);返回逐文件结果 |
| `localsend_send_plugin` | 把 DSH 插件目录打包成自包含分发 zip(排除 `node_modules`/`.git`,内含 `dsh-plugin.manifest.json` 清单与 `INSTALL.md` 安装卡),生成临时 HTTP 下载链接;**接收方只要浏览器即可下载,无需安装任何软件** |
| `localsend_share` | 本地文件/文件夹生成临时 HTTP 下载链接,接收方浏览器打开即下载(含密码保护、断点续传、下完自动关) |
| `localsend_smb_push` | **接收方不装任何软件**时,把文件/文件夹经 SMB 共享复制到目标机器的**指定目录**:你指定 `target`(IP/主机名)、`share`(共享名)、`destDir`(共享下子目录)、`files`;复制全自动,无需接收方点。需接收方预先开共享并给发送方写权限 |

## 配置(settings 命名空间 `localsend`)

| 键 | 默认 | 说明 |
|---|---|---|
| `alias` | 自动(主机名) | 接收端看到的发送方别名 |
| `port` | 53317 | 目标 LocalSend 端口 |
| `scanTimeoutMs` | 1500 | 单 IP 探测超时 |
| `acceptTimeoutMs` | 240000 | 等待接收端接受上限 |
| `uploadTimeoutMs` | 120000 | 单文件上传超时 |
| `maxFileBytes` | 1 GiB | 单文件上限(v1 整文件读入内存) |

以上配置在 **GUI「设置 → 插件配置」** 里以「LocalSend 局域网传输」卡片展示(键 = settings 命名空间
`localsend`,由 `client.js` 注册),可在线编辑;保存后新会话的工具调用即生效。

## 安全约定

- 仅限同一局域网;扫描不出子网、不跨网关。
- 探测只读(`info`)。发送必须是"用户明确点名的目标 + 用户明确点名的文件"。
- 接收端默认需人工点"接受"(或已开自动接收);协议无共享密钥,弹窗即授权闸门。
- 接收端返回一律视为不可信数据。

## 安装到 DSH profile

1. 源码放在 `dsh-plugin\dsh-localsend`;
2. 像其他本地插件一样加入 profile:`dependencies`(`link:` 指向源码)+ `dsh.profile.bundles`,
   并让 profile 的 `node_modules` 可解析到本包;
3. host 半边重启即生效(重启后的新会话出现工具);**浏览器半边**(设置卡片)需前端加载新 client
   插件——dev 实例需重新编译 web 工件(或运行 `dev:web` watcher),正式包则重启后刷新页面。
4. 「设置 → 插件配置」看到「LocalSend 局域网传输」即表示 client 半边生效。

## 开发与测试

```bash
npm run check   # node --check 所有入口
npm test        # 单测 + 本地 mock 接收端端到端(不联网)
npm run verify
```

## 过程文档

`docs/aegis/plans/2026-09-08-localsend-plugin-transfer.md`(v0.3.0 插件传输方案)与 `docs/aegis/baseline/`(实测复盘、协议要点、插件设计基线)。

## License

MIT
