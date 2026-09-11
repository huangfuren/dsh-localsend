# Changelog

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
