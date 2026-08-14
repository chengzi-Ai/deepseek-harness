# Agent Note: Windows 桌面分发（dsh-desktop）

Status: implemented

English | [中文](2026-08-15-desktop-windows-distribution.zh.md)

## 问题

DeepSeek Harness 浏览器界面（`dsh web`）需要 Node 安装与浏览器。想要普通
桌面应用体验的人——双击 `.exe`、得到一个窗口——没有对应的分发形态：CLI
是终端应用，单文件 exe 流水线
（[2026-07-10-single-file-executable-sdk-runtime-distribution.md](2026-07-10-single-file-executable-sdk-runtime-distribution.md)）
打包的是 stdio JSON-RPC 服务端，不是 GUI。

## 决策

### 外壳是 Electron；harness 是子 Node 进程

[`apps/desktop`](../../../../apps/desktop/README.zh.md)
（`@deepseek-ai/dsh-desktop`）是 Electron 外壳。主进程以
`ELECTRON_RUN_AS_NODE=1` 在 `process.execPath` 之上把打包的 harness 作为子
进程启动，因此 harness 运行在 Electron 内嵌的 Node 上（无需另行携带
Node），并在子进程 argv 上加 `--expose-internals`：vendored Loader 在该标志下
直接访问 Node 内部 ESM loader，而其回退方案原生插件
（`node-addon-require-builtin`）是针对 Node ABI 编译的，Electron 内嵌的
Node 并不共享该 ABI。子进程入口是构建后的 `apps/cli` bin
（`lib/bin.js web --port 0`）：与 CLI 提供的组合完全相同。外壳在 spawn 之前先
打开一个启动占位窗口——双击必然立刻出现可见窗口——并在就绪行出现后把该窗口
切换到 harness URL。退出时用 `taskkill /T /F` 终止 harness：Windows 不会向
隐藏的无控制台子进程投递优雅信号，因此 JSONL 会话日志的逐事件同步写入就是
持久性边界。

进程内方案（在 Electron main 中导入 `runProfile`）被否决：它把 cordis 树与
Electron 的事件循环和生命周期耦合在一起，而子进程方案保持与 `dsh web`
完全一致的语义并隔离崩溃。单独携带 Node 二进制也被否决，因为
`ELECTRON_RUN_AS_NODE` 已消除该需求。

### 闭包直接部署 `@deepseek-ai/dsh`

与 Python SDK 运行时不同——那里需要一个专门的零代码闭包清单，因为
JSONRPC demo bin 刻意只有很小的依赖面——`apps/cli` 就是随包发布的
web-capable 应用：它的 `dependencies`（经由 `dsh-base` 与 `dsh-web-app`）
就是完整的 web profile 插件集合。因此构建脚本直接部署 `@deepseek-ai/dsh`，采用与 SEA 流水线相同的
legacy-deploy 路线（`--legacy --prod --config.node-linker=hoisted
--config.link-workspace-packages=true`），并刻意保留一个差异：peer 自动安装
保持开启。极简 SDK bin 可以负担封闭的确定性集合，但 web 闭包含有仅以
peer 形式存在的 Service Definition 包（`dsh-invariants`），消费者安装发布版
应用时同样会自动安装它们，因此禁用 peer 会交付一棵 Loader 无法解析的树。
脚本随后恢复 legacy hoist，并把每个符号链接物化为真实文件，使暂存树无符号
链接。electron-builder 把暂存树作为 extraResources（真实文件，非 asar）
打包，从而保证打包应用内的 Node 模块解析与原生插件正常工作。

### 桌面应用共享默认 Harness home

子进程继承环境，`$DSH_HOME` 默认为 `~/.dsh`，因此已有的 `dsh web` 安装会
保留其凭据（`~/.dsh/.credentials.yaml`）、设置、会话与 profile。
`profiles/node_modules` 的 junction 回退由 harness 在每次启动时重新修复，
指向打包树。

### 验证是分阶段的

构建脚本在打包前，会在一次性 `DSH_HOME` 下对暂存的 harness 做启动冒烟：
它必须打印就绪 URL 并以 HTTP 200 提供 index，从而完全针对打包树检验
profile 模板、bundle 解析、插件加载与前端服务。

## 测试

- 单元：`apps/desktop/tests/url-line.spec.ts` 覆盖就绪行解析器（普通行、
  LAN 后缀行、非就绪行）。
- 构建期：上文所述的暂存 harness 启动冒烟运行在
  `scripts/build-desktop-exe.ts` 中，闭包不能服务时构建失败。
- 手动：`pnpm --filter @deepseek-ai/dsh-desktop exec electron .` 针对检出目录
  已构建的 CLI 运行外壳；打包后的 exe 从 `apps/desktop/release/` 启动。

## 备选方案

- **在 Electron main 内进程内启动**：否决，见决策。
- **再携带一个 Node 二进制**：否决，`ELECTRON_RUN_AS_NODE` 已把
  Electron 的 Node 提供给子进程。
- **整个应用用 `pkg --sea`**：否决，pkg 打包的是 Node 而非 Chromium；
  Electron 是唯一的现实 Windows GUI 载体。
- **裸 Vite 包装**：否决，外壳必须提供注入 `window.__DSH_BOOT__` 的完整
  宿主；只有 `dsh web` 能做到。

## 后果

**买到的**：Windows 上双击 `.exe` 即得 harness GUI 桌面窗口；exe 之外零
额外运行时；与 `dsh web` 完全一致的组合（CLI 与桌面不漂移）；通过默认
home 与 CLI 共享凭据与状态。

**付出的**：便携目标每次启动都要重新解压约 300 MB 载荷，慢速磁盘 +
Defender 扫描时首个窗口可能要等几分钟——因此**推荐**按用户安装的 NSIS
安装器（一次安装、启动以秒计，实测 harness 就绪 5.4 秒）；harness 退出是
硬杀，因此退出时的崩溃窗口就是持久性边界；暂无图标与代码签名，SmartScreen
可能告警；仅限 Windows（其他平台暂不在范围内）。
