# dsh-desktop — dsh web profile 的 Windows 桌面外壳

`@deepseek-ai/dsh-desktop` 是一个 Electron 外壳，把打包后的 DeepSeek
Harness 浏览器界面以原生 Windows 窗口形式运行。它以子 Node 进程方式启动随包
分发的 `dsh` CLI（`lib/bin.js web --port 0`）——通过 `ELECTRON_RUN_AS_NODE`
外加 `--expose-internals`，因此无需另行携带 Node，且 vendored Loader 无需其
按 Node ABI 编译的回退插件即可访问 Node 内部 ESM loader——等待 harness 的
就绪 URL 后，在其上打开一个 `BrowserWindow`。关闭窗口即终止 harness 进程树
并退出。

## exe 内部包含什么

- Electron 外壳（本包）。
- 完整的 `@deepseek-ai/dsh` web profile 闭包：全部插件、vendored Cordis
  实例、以及构建好的 `apps/web` 前端 dist，经由与单文件 SDK 运行时相同的
  legacy-deploy + 符号链接物化路线
  （`.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md`）
  部署，并以 electron-builder extraResources 形式暂存于
  `apps/desktop/out/harness`。

exe 运行与 CLI 完全相同的 `dsh web` 组合。它共享默认 Harness home
（`$DSH_HOME`，否则 `~/.dsh`），因此已有的 `dsh web` 安装会保留其凭据
（`~/.dsh/.credentials.yaml`）、设置、会话与 profile。

## 构建

```sh
pnpm exec tsx scripts/build-desktop-exe.ts
```

该脚本会构建仓库（lib + web dist）、部署并物化闭包、在一次性 `DSH_HOME`
下对暂存的 harness 做启动冒烟测试，然后运行 electron-builder。两个 Windows
产物产出到 `apps/desktop/release/`：

- `DeepSeek-Harness-<version>-setup-x64.exe` —— **推荐**：按用户安装的 NSIS
  安装器（安装一次；之后启动只需数秒，且外壳会立即显示启动窗口）。
- `DeepSeek-Harness-<version>-portable-x64.exe` —— 单文件便携 exe；每次启动
  都要把约 300 MB 的载荷重新解压到临时目录，慢速磁盘 + Defender 扫描时首个
  窗口可能要等几分钟。

可选标志：`--skip-build`（产物已存在）、`--skip-smoke`（跳过暂存 harness 的
启动测试）。

## 开发

不打包、直接针对仓库已构建的 CLI 运行外壳：

```sh
pnpm run build          # 先构建一次仓库 lib + web dist
pnpm --filter @deepseek-ai/dsh-desktop exec tsc -p tsconfig.json
pnpm --filter @deepseek-ai/dsh-desktop exec electron .
```

外壳从检出目录启动 `apps/cli/lib/bin.js web --port 0`。harness 输出会镜像到
Electron user-data 目录下的 `harness.log`（打包后为
`%APPDATA%/DeepSeek Harness/`）。

## 已知限制与后续工作

- 退出时用 `taskkill /T /F` 终止 harness：Windows 不会向隐藏的无控制台子进程
  投递优雅信号，因此 JSONL 会话日志的逐事件同步写入就是持久性边界。
- 便携目标每次启动都会把约 300 MB 的载荷自解压到临时目录，启动需要数秒；
  NSIS 安装器是面向已安装启动的自然后续。
- 尚未提供应用图标；electron-builder 回退到默认的 Electron 图标。
- exe 未签名，SmartScreen 可能在首次启动时告警。
