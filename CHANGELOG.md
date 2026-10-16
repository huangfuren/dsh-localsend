# Changelog

## Unreleased

- **修复 SMB 推送复制步骤从未成功过的致命 bug**：`robocopy` 的参数被手工加了引号。
  `execFile` **不经 shell**，参数里的引号会被原样交给程序，而 `robocopy` 自己不做引号剥离 ——
  带引号的路径让它直接以 `exit 16`（语法/参数错误）拒绝执行，**一个文件都不会复制**
  （实测：带引号 exit=16、目标目录为空；裸参数 exit=1、文件正确落盘）。现改为传裸参数。
  这条通道此前「挂载修好了、复制仍必然失败」，与 0.5.0 修的挂载 bug 是同一类的**只在真机
  才暴露**的问题。
- **新增两条 `robocopy` 实机用例与一条引号回归用例**：单测过去只断言「参数构造」，证明不了
  「文件落到了哪」。现在在 Windows 上真跑一次 `robocopy`（纯本地临时目录，不联网），断言
  落盘位置；CI 的 ubuntu / macos 组合自动跳过。
- **修复 SMB 推送单文件会多出一层同名目录**：`robocopy` 的「目标」参数**恒为目录**，而单文件
  分支把目标写成了 `<destDir>\<leaf>`，于是文件实际落到 `…\<leaf>\<leaf>`。现在单文件的目标
  就是 `destDir` 本身、文件名作为第三个位置参数；目录分支不变（目标即 `<destDir>\<leaf>`）。
- **设置项 `sharePort` / `shareExpiresIn` / `sharePassword` 真正生效**：三者此前只定义了 schema、
  渲染了设置卡片、写进了 README，但 host 端引用数为 0 —— **改了不生效**。现新增纯函数
  `resolveShareOptions()`（显式参数优先 → 设置项兜底 → 内置默认），`localsend_share` 与
  `localsend_send_plugin` 均改用它，并在入口配置里补齐三者默认值。
- **修复 `expiresIn: 0`（无有效期）在参数层不可达**：旧实现写 `Number(x) || 3600`，把显式传入
  的 `0` 当成假值吞成了 `3600`，与 README / 工具描述里「0 = no expiry」的承诺矛盾；`port` 同理。
  现在只有「未提供」才回落默认，`0` 与空串按原样生效。
- **修复分享通道「调用后永久挂起」的致命 bug —— `localsend_share` / `localsend_send_plugin`
  此前从未真正可用过**：`createShareSession()` 用 `resolve({url,token,port,expires,files,close})`
  返回了一个**新建的对象字面量**，而 `closed` / `downloaded` / `onDone` / `temps` 只存在于内部
  会话对象上。两个工具都写 `session.onDone = fn` 等下载结束 —— 回调落在另一个对象上，
  `shutdown()` 永远读不到，于是 `await` 永不返回。宿主侧也没有兜底：`timeoutMs` 在 DSH 里
  **仅作声明、不强制执行**，所以工具会一直挂到用户手动取消，而取消又会关掉服务器、只拿回一条死链。
  实测：`expiresIn: 5` 在 8 秒后 `onDone` 仍未触发，且返回对象上 `closed === undefined`。
  现在 `createShareSession()` 直接 resolve 会话本身；两个工具改为**生成链接后立即返回**，
  服务器在后台继续服务直到过期或全部下载完成；临时 zip 改由会话持有、在会话关闭时清理
  （此前由工具在 `finally` 里删除 —— 一旦改为立即返回，链接就会指向已被删掉的文件）；
  工具也不再绑定 `exec.signal`，否则对话一结束服务器就被关掉。
- **分享链接改为根路径**：多文件时 `/dl/<token>` 只会给出第 1 个文件（实测响应体只含第 1 个），
  现在对外给 `http://<ip>:<port>/` —— 多文件渲染列表页，单文件自动 302 跳转到下载。
- **新增 6 条分享会话契约测试**（`test/share-session.test.js`）：锁住「返回的是会话本身」、
  `onDone` 在「下载完成 / 到期 / 手动 close」三种情形下都会触发、临时文件随会话清理、
  根路径渲染多文件列表页。此前 `grep onDone test/` **零命中** —— 50 个用例全绿也测不出这个 bug。
- **大目录打包改为流式写入，内存占用降一个数量级**：`packDirectory()` 过去先由
  `collectDirectory()` 把**每个文件的内容读进内存攒成数组**，再交给 `createZip()` 一次性
  concat 出完整 zip —— 整个过程中「全部原始数据 + 全部压缩结果 + 最终 buffer」同时驻留。
  实测打包 60 MB 目录（20 个 3 MB 不可压缩文件）后仍驻留 **375 MB**。现在新增
  `writeZipFile()`（`lib/zip.js`）逐文件「读入 → 压缩 → 写盘 → 释放」，`collectDirectory()`
  只收集文件清单（`stat`，不读内容），同样输入驻留降到 **21.5 MB**。`createZip()` 保留给
  插件包等小体量输入。
- **zip 写入改用 `FileHandle` 顺序写**：先前的 `WriteStream` 版在「首个文件读取即失败」时，
  异步 open 会在调用方结束之后才落地并抛 `ENOENT`（实测触发 `uncaughtException`）；
  改用 `fs.promises.open()` + 顺序 `write()` 后收尾干净，失败时也不会在磁盘上留下半截 zip。
- **分享链接不再指向虚拟网卡**：`getLocalIp()` 旧实现取「第一个非内部 IPv4」—— 装了
  WSL / Hyper-V / VirtualBox / Docker 时枚举顺序常把虚拟网卡排在前面，链接于是指向对端
  根本访问不到的地址。现在新增 `getLocalIps()` 返回全部候选，`getLocalIp()` 优先物理网卡、
  跳过链路本地 `169.254.x`，全是虚拟网卡时才退回第一个候选；`localsend_share` 在多网卡时
  会把所有候选地址打进日志，便于手动替换。

## 0.5.0 (2026-10-10)

- **新增「目标机档案」（`smbProfiles`）**：设置卡片里可为每台目标机保存一条档案
  （档案名 / 目标 IP / 共享名 / 共享下子目录 / 账户 / 密码），`localsend_smb_push` 只需
  `profile="<名>"` + `files` 直推；任何显式参数（`target`/`share`/`destDir`/`username`/`password`）
  按字段覆盖档案。把「无软件推送」从"每次重填 5 个参数"变成"配一次 + 一条命令"。
  新增 `lib/smb.js` 的 `findProfile()`（按名查找，找不到时列出已配置的档案名）与
  `mergeProfile()`（显式参数优先、空值回落到档案）。
- **设置卡片新增档案编辑器**：可增删档案行，六字段（密码用 `password` 输入框）；
  保存前校验「档案名与主机必填、档案名唯一」，两端文案均双语。
- **修复 `localsend_smb_push` 从未成功挂载的致命 bug**：`mountShare()` 曾把 `targetDir` 单独
  拼一次，而 `buildNetUseArgs()` 的返回值里已含它 —— `net` 因此收到两个 devicename 加上凭据
  共 4 个位置参数，直接打印用法说明（语法错误）。**带凭据与来宾登录两条路径都必然失败**，
  即该通道此前从未真正跑通。现改为 `net use <buildNetUseArgs 返回的完整参数>`，并新增
  「目标只出现一次」的回归用例；同时把 `net` 错误 67（找不到网络名）并入「找不到网络路径」提示。
- **安全约定更新**：档案中的凭据（含密码）以**明文**保存在本机 DSH settings 文件里，会随该文件
  被同步/备份而流转 —— 这是为「自己的多台机器之间推送」做的取舍。README 中英两版均已标注
  「勿在共享/多人机器上启用」，并修正原先"不存储任何凭据"的无条件表述。
- **文档：README 默认语言改为中文并同步中英两版内容。** 语言约定统一为 `README.md`（中文，默认入口）+
  `README.en.md`（英文），两版顶部互链；`README.zh-CN.md` 已并入 `README.md` 并删除。
  同时修正中文版遗留的版本号、补齐 `localsend_smb_push` 与 peer 范围的准确描述，
  使中英两版与当前包状态一致。`files` 改为分发 `README.en.md`。
- **脱敏**：清除 `lib/tools/smb.js` 参数示例与 `test/smb.test.js` 中的真实内网 IP 与主机名
  （统一改用文档专用网段 `192.0.2.10` 与占位主机名 `TARGET-PC`），并把 `test/unit.test.js` 中
  疑似本机网卡地址归一为通用示例 `192.168.1.66`。

## 0.4.1 (2026-09-30)

- **修复设置卡片崩溃导致「内置插件」页签空白**：卡片在 `useEffect` 里调用 `face.localePreference()`，
  但注入的 `face` 只提供了 `readValues` / `saveValues`，调用即抛 `TypeError`，
  整张卡片连同面板被 React 摘掉 —— 表现为在 设置 → 内置插件 里选中「LocalSend 局域网传输」后下方全空。
  现在 `face` 提供 `localePreference()`（优先宿主 locale 服务，缺失时回退浏览器语言），
  调用侧同时加能力探测 + `try/catch`：旧版 `face` 缺这个方法时只损失语言切换，不再影响卡片渲染。
- 兼容性：不新增宿主 API 依赖，对 dsh 0.1.x 与 0.2.0-rc.1 均安全。

## 0.4.0 (2026-09-12)

- **新增 `localsend_smb_push`**:`接收方无需安装任何软件` 时把文件/文件夹经 SMB 文件共享推送到目标机器的**指定目录**。
  参数 `target`(IP/主机名)、`share`(共享名)、`destDir`(共享下子目录,可空=共享根)、`files`、`username`/`password`(可选,匿名=来宾)。
  目录自动打包成 zip 再复制;全自动,无需接收方点"接受"。实现 `lib/smb.js`(零依赖,`net use` + `robocopy`),
  工具层 `lib/tools/smb.js` 仅做薄组合。
- 定位:本地 `localsend_send_files` 强制接收方装 LocalSend;`localsend_share`/`localsend_send_plugin` 的浏览器链接无法指定落盘目录。
  本工具补上"`无软件 + 指定 IP + 指定目录 + 全自动`"的唯一可行通道(前提:接收方预先开共享并给写权限)。
- 错误信息细化:登录失败(密码错/微软账户误用 PIN)、访问被拒(需关密码保护共享+允许不安全来宾登录)、找不到网络路径(离线/防火墙)均给出可读提示。
- 测试:`test/smb.test.js` 覆盖 UNC 拼接、`net use` 参数(guest/凭据/仅用户名)、`robocopy` 参数(单文件/目录、`/COPY:DAT`、`/E`)。
- 系统提示 GUIDANCE 增补 SMB 通道使用指引。

## 0.3.1 (2026-09-12)

- **修复 `dsh web` 启动失败**:`localsend_share` 与 `localsend_send_plugin` 的 output schema 用了 `required: [...]` 数组,
  宿主 dsh 的 value schema DSL 只接受逐属性 `required: true`,插件树加载因此报
  `unsupported JSON schema: schema.required is not supported by the value schema DSL` 并中断启动。已改为逐属性声明。
- **修复会话历史损坏(resume 失败)**:`localsend_list_devices` 与 `localsend_send_files` 的 `output.render` 返回裸字符串,
  而 dsh 契约要求返回内容块数组(`ContentBlock[]`)。裸字符串被原样写进 `tool/result` 事件,导致该会话此后每次加载都报
  `SessionPersistenceCorruptionError: session event at seq N message must contain one tool-result block`。
  现已改为 `[{ type: 'text', text: String(value) }]`,与其余工具一致。
- 升级提示:0.3.0 及更早版本产生的历史会话若调用过上述两个工具,需先修复 `tool-result.content`(字符串包装为文本块)才能恢复加载。

## 0.3.0 (2026-09-08)

- **新增 `localsend_send_plugin`**:把 DSH 插件目录打包成自包含分发 zip(`<name>-<version>.dsh-plugin.zip`),
  经临时 HTTP 链接分享——**接收方无需安装任何软件**,浏览器打开即下载。包内排除 `node_modules`/`.git`,
  含 `dsh-plugin.manifest.json`(逐文件 sha256 清单 + 安装命令模板)与 `INSTALL.md`(一条命令安装卡)。
- 包格式 `dsh-plugin-package` v1;清单列出 name/version/minDsh/tools 及每个文件的 sha256,便于将来接收端装包器消费。
- 新增 `lib/plugin-pack.js`:插件感知打包(零依赖,复用 `lib/zip.js`);工具仅做薄组合层,可独立测试。
- `plugin` 参数接受**绝对目录路径**或**已安装插件名**(只读地在 `~/.dsh/profiles/*/node_modules` 下解析);
  分发 dsh-localsend 自身只需 `plugin="dsh-localsend"`。
- 新增配置 `dshProfileDir`(默认 `~/.dsh`),用于按名解析插件;解析全程只读,不改 profile。
- `localsend_share` 输出升级为结构化对象(含 `url` / 每文件 `files` / `totalSize` / `expiresIn` / `password` / `log`),
  原日志文本保留在 `log` 字段,向后兼容。
- 测试:`test/plugin-pack.test.js` 覆盖排除规则、清单、安装卡、zip 往返,以及"打包→HTTP 链接→浏览器下载"端到端。

## 0.2.0 (2026-09-08)

- **发布规范化**:README 改为单一中文文档;package.json 补齐 author / repository / homepage / bugs /
  `engines.dsh` / publishConfig 等发布字段,对齐 dsh-outline-auto 的仓库规范;新增 `.gitignore`。

- **兼容性增强(开箱即用)**:
  - peer 显式放宽并核对到当前两代宿主:`dsh-tools / client runtime / connection / api-remotes / ui-slots >=0.1.0-rc.6 <0.2.0`(兼容 0.1.1-rc.2 与 0.1.3-alpha.1);
  - `dsh.client.inject` 补齐 `dsh-client-ui-slots`(与 alpha.1 在用插件一致);
  - 清理产物中的本机绝对路径残留;确认无构建步骤、可 `npm pack` 分发;
  - README 增加第三方安装与兼容性说明(中英)。

- **新增 `localsend_share`**:局域网临时 HTTP 下载分享,**接收方无需安装任何软件**,用浏览器打开链接即可下载。
- 实现 `lib/share.js`:临时 HTTP 服务器 + 下载页(自适应单/多文件);可选密码保护(Basic Auth);支持 `Range` 断点续传;
  下载完成或到期自动关闭服务器(一次性链接,防泄露)。
- 目录自动打包成 zip 后分享;小于 64MB 计算 sha256 校验。
- 新增 settings 字段:`sharePort`(监听端口,0=随机)、`shareExpiresIn`(默认有效期秒)、`sharePassword`(默认下载密码);
  浏览器设置卡片已同步显示这三项。
- 适用:同一局域网内任意设备(Windows/macOS/Linux 或手机浏览器)收文件;跨网络场景后续版本支持(隧道/中继/云存储)。
- 其余行为同 0.1.2(文件/文件夹发送、目录自动 zip、设置卡片、17 项测试)。

## 0.1.2 (2026-09-05)

- 新增"文件夹直接发送":`localsend_send_files` 的 `files` 可传目录,插件用零依赖 zip 写入器
  (`lib/zip.js` + `lib/pack.js`)自动打成 `<文件夹名>.zip` 再发送,接收端收到 zip;发送结束清理临时包。
- 混合发送:同一列表里文件和文件夹可并存(文件直发,目录各自打包)。
- 约束:跳过符号链接与空目录;单包不超过 `maxFileBytes`(默认 1 GiB)。
- 测试:zip 写入/解析回读、CRC-32 校验、目录打包与清理、mock 端到端"目录→zip→上传"。

## 0.1.1 (2026-09-05)

- 新增浏览器设置卡片(client.js):在「设置 → 插件配置」列表中以 `localsend` 命名空间显示,
  可编辑发送方别名/端口/各类超时/文件大小上限;保存写入 Host settings 命名空间,新会话工具调用生效。

## 0.1.0 (2026-09-05)

- 首版:LocalSend v2 上传协议发送端(host 工具插件)。
- 工具:`localsend_list_devices`(局域网只读扫描)、`localsend_send_files`(别名/IP 发送,sha256 校验)。
- 零第三方运行时依赖;settings 命名空间 `localsend` 可配置。
- 测试:纯函数单测 + 本地 mock 接收端端到端(成功/422 校验失败/cancel)。
