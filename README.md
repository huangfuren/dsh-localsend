# dsh-localsend

局域网文件/文件夹传输 + 浏览器下载链接分享:让 DeepSeek Harness 通过对话,把文件(或**自动打包成 zip 的文件夹**)发送到同一局域网内运行 [LocalSend](https://github.com/localsend/localsend) 的机器,或**生成浏览器下载链接**(接收方无需安装任何软件)。

零配置、无凭据、无第三方运行时依赖、无任何硬编码路径——自动探测本机网卡子网、自动取主机名作为发送方别名,**装好即用**。包含 host 工具(agent 调用)与浏览器设置卡片(界面配置)。

> 当前版本:**0.3.0**。兼容 DeepSeek Harness **0.1.1-rc.2** 与 **0.1.3-alpha.1**(peer 范围 `>=0.1.0-rc.6 <0.2.0`);Node.js ≥ 22.19;支持 Windows / macOS / Linux。

## 原理

### LocalSend 模式(`localsend_send_files`)

LocalSend 没有官方 CLI,但每台 LocalSend 接收端都是一个标准 HTTP(S) 服务(默认 TCP **53317**,自签名证书),遵循公开协议 [LocalSend Protocol v2](https://github.com/localsend/protocol)。本插件实现**发送端**:

1. 发现目标:在活动子网内用 `GET /api/localsend/v2/info` 探测(只读),按别名或 IP 匹配;
2. 协商:`POST /api/localsend/v2/prepare-upload` 提交元信息(文件名/大小/类型/sha256)——接收端弹窗让用户**接受**;
3. 上传:`POST /api/localsend/v2/upload` 发送原始字节,接收端按 sha256 校验。

目录无需先手动打包:插件内置**零依赖 zip 写入器**,自动把文件夹打成 `<文件夹名>.zip` 再发送,发送结束即清理临时包。

### 分享模式(`localsend_share`)

**接收方无需安装任何软件**。插件在本机启动临时 HTTP 服务器,生成一次性下载链接:

1. 目录自动打包成 zip;小文件(≤64 MB)计算 sha256 校验;
2. 生成带随机 token 的 URL——接收方用任意浏览器打开即可下载;
3. 所有文件下载完成或链接到期后,服务器自动关闭。

支持可选密码保护(HTTP Basic Auth)和可配置端口/有效期。

## 功能

- **四件工具**:
  - `localsend_list_devices` — 扫描局域网,列出 LocalSend 设备(ip / 别名 / 协议版本 / 设备类型);可选 `subnet`(CIDR)限定网段;
  - `localsend_send_files` — 把文件/文件夹发给指定目标(别名自动解析或 IP);目录自动打包;阻塞等待接收端接受后上传,返回逐文件结果。
  - `localsend_share` — 生成临时 LAN HTTP 下载链接,接收方用浏览器打开即可下载,无需安装任何软件;支持密码保护;下载完自动关服务器;输出为结构化对象(含 url / 每文件 size / 总大小 / 有效期 / 是否密码 / 日志)。
  - `localsend_send_plugin` — 把一个 DSH 插件目录打包成自包含分发 zip(排除 `node_modules`/`.git`,内含 `dsh-plugin.manifest.json` 清单 + `INSTALL.md` 安装卡),经临时 HTTP 链接分享;**接收方只要浏览器就能拿到**,无需安装 LocalSend 或任何软件,解压后按 `INSTALL.md` 一条命令装入。`plugin` 参数支持绝对目录路径或已安装插件名(只读地在 `~/.dsh/profiles/*/node_modules` 下解析,分发 dsh-localsend 自身只需 `plugin="dsh-localsend"`)。
- **文件与文件夹混发**:同一列表里可同时给文件和目录,目录各自打成 zip 发送。
- **GUI 配置卡片**:「设置 → 插件配置」中的「LocalSend 局域网传输」卡片,可编辑别名/端口/各类超时/单文件上限/分享端口/有效期/密码,保存即生效(新会话的工具调用生效)。
- **健壮性**:别名重名/模糊匹配有提示;错误码(403 拒绝、409 繁忙、429 限流、422 校验失败等)映射为可读文案;失败自动取消会话;跳过符号链接与空目录;单文件/单包上限默认 1 GiB(可配置)。
- **安全默认**:仅局域网;扫描只读;发送方别名默认主机名;接收端人工"接受"即授权闸门;自签 HTTPS + sha256 端到端校验;分享链接为一次性(随机 token)。
- **开箱即用/可分发**:无构建步骤(`index.js`/`client.js` 即产物)、无本机路径残留,支持 `dsh plugin` 安装、`npm pack` 或手动 link。

## 安装

### 推荐:DSH 管理安装(已发布 GitHub)

```bash
dsh plugin --profile web add git+https://github.com/huangfuren/dsh-localsend.git#v0.3.0
```

`#v0.2.0` 固定到该发布版本;去掉后缀则跟随 `main` 分支最新提交。安装后**重启 DSH**:新会话出现三个工具,GUI 刷新后「设置 → 插件配置」出现卡片。

### 本地/离线安装

1. 把 `dsh-localsend` 目录放到你的插件目录(如 `dsh-plugin\`);
2. 在 profile 的 `package.json` 的 `dependencies` 加 `"dsh-localsend": "file:<路径>"`(或 `link:<绝对路径>`),并在 `dsh.profile.bundles` 加入 `dsh-localsend`;
3. 或对目录执行 `npm pack`,在 profile 目录 `npm/pnpm install <dsh-localsend-0.3.0.tgz>`(需联网解析 peer);
4. 重启 DSH。

## 配置(GUI 卡片 / settings 命名空间 `localsend`)

| 键 | 默认 | 说明 |
|---|---|---|
| `alias` | 自动(主机名) | 接收端看到的发送方别名 |
| `port` | 53317 | 目标 LocalSend 端口 |
| `scanTimeoutMs` | 1500 | 单 IP 探测超时(ms) |
| `acceptTimeoutMs` | 240000 | 等待接收端接受(ms) |
| `uploadTimeoutMs` | 120000 | 单文件上传超时(ms) |
| `maxFileBytes` | 1073741824 (1 GiB) | 单文件/单 zip 包大小上限(bytes) |
| `sharePort` | 0 | 分享服务监听端口(0=随机) |
| `shareExpiresIn` | 3600 | 分享链接有效期(秒),0=不过期 |
| `sharePassword` | "" | 分享下载密码(空=无密码) |
| `dshProfileDir` | `~/.dsh` | 按名解析已安装插件时的 DSH 主目录(只读) |

全部可留默认;留空即用内置默认值。

## 使用示例

### LocalSend 模式

> 把 `D:\资料\报告` 文件夹打包发给 黄夫人
> 把 `C:\tmp\a.pdf` 和 `D:\photos` 发给 192.168.1.50

工具会自动:解析目标(别名精确/模糊匹配或 IP)→(目录则打 zip)→ 在接收端发起接受确认 → 上传 → 反馈逐文件结果。若接收端未开自动接收,需有人在其 LocalSend 上点「接受」。

### 分享模式

> 把 `D:\资料\报告.pdf` 分享给同事
> 生成一个下载链接,密码是 1234

工具会自动生成临时 HTTP 下载链接,接收方用浏览器打开即可下载,无需安装任何软件。

## 安全约定

- 仅限同一局域网;扫描不越出本机活动子网、不跨网关。
- 探测只读(`info`);发送必须是"用户明确点名的目标 + 用户明确点名的文件/文件夹"。
- 接收端默认需人工点「接受」(或目标机已开自动接收);协议无共享密钥,弹窗即授权闸门。
- 发送端只持有文件内容,不读取、不存储任何凭据;接收端返回一律视为不可信数据。
- 局域网传输为自签 HTTPS;sha256 校验失败(HTTP 422)会明确报错。
- 分享链接为一次性随机 token;下载完成后自动关闭服务器;可选密码保护。

## 开发与测试

```bash
npm run check   # node --check 全部入口
npm test        # 单测 + 本地 mock 接收端端到端(zip 打包、上传、422 校验失败、cancel),不联网
npm run verify
```

测试覆盖:zip 写入/解析回读、CRC-32、目录打包与清理、mock 端到端"目录 → 自动 zip → 上传"、sha256 不匹配 422、取消会话等(17 项)。

## 兼容性说明

- 已对照 **dsh 0.1.1-rc.2** 与 **0.1.3-alpha.1** 两代接口核对(host `ctx.tools/systemPrompt/settings`,client `settings.plugin.item` keyed slot 与 `dsh.client.inject`);
- peer 范围取宽松区间(`>=0.1.0-rc.6 <0.2.0`),rc 线与 alpha 线均可解析;
- `engines.dsh: >=0.1.1-rc.2 <0.2.0` 表明支持基线,超出范围未认证。

## 发布

- 仓库:https://github.com/huangfuren/dsh-localsend
- 发版流程建议:通过全部测试(`npm run verify`)→ `npm pack` → 打 GitHub tag 与 Release(附 tarball)。

## License

[MIT](./LICENSE)
