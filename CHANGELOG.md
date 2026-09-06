# Changelog

## 0.2.0 (2026-09-06)

- **兼容性增强(开箱即用)**:
  - peer 显式放宽并核对到当前两代宿主:`dsh-tools / client runtime / connection / api-remotes / ui-slots >=0.1.0-rc.6 <0.2.0`(兼容 0.1.1-rc.2 与 0.1.3-alpha.1);
  - `dsh.client.inject` 补齐 `dsh-client-ui-slots`(与 alpha.1 在用插件一致);
  - 清理产物中的本机绝对路径残留;确认无构建步骤、可 `npm pack` 分发;
  - README 增加第三方安装与兼容性说明(中英)。
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
