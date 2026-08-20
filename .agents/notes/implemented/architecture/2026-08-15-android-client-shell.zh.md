# Agent Note: Web GUI 的 Android 客户端壳（dsh-mobile）

Status: implemented

English | [中文](2026-08-15-android-client-shell.zh.md)

## 问题

DeepSeek Harness 浏览器界面绑定于运行中的 `dsh web` 宿主：宿主注入
`window.__DSH_BOOT__`、提供 `/plugins/*/client.js` bundle，并拥有 `/api`，
因此 GUI 不是静态站点。想用手机使用 harness 的人没有任何可安装的客户端。

## 决策

### 手机是纯客户端；harness 留在服务器上

[`apps/mobile`](../../../../apps/mobile/README.zh.md)（`dsh-mobile`）是一个
Capacitor Android 应用：WebView 全屏加载用户配置的远程 `dsh web` 地址。
应用不包含任何 harness 内容——手机无法运行 Node 运行时（原生模块、终端、
文件系统），而 GUI 本来也无法静态提供，因此客户端/服务端拆分是结构性事实，
而非妥协。首启页面把服务器地址写入 localStorage 并导航 WebView 过去；
`server.cleartext` 允许纯 http 的局域网/Tailscale 服务器，
`allowNavigation: ['*']` 让远程页面留在 WebView 内。

桌面分发
（[2026-08-15-desktop-windows-distribution.md](2026-08-15-desktop-windows-distribution.md)）
描述了服务端：用 `dsh web --host <地址> --trusted-host <地址>:<端口>` 绑定到
Tailscale/局域网网卡，而不是暴露公网。

### 配置用 JSON 而非 TypeScript

`capacitor.config.json` 取代常见的 `.ts` 形式：Capacitor 的 TS 加载器用
workspace 的 TypeScript 转译配置，在本检出上产出空模块并使 `cap add`
失败。JSON 无需加载器且字段相同。

### Android 工程生成后提交

`android/` 是 `cap add android` 的产物，像普通 Capacitor 工程一样提交，
干净检出即可直接 `./gradlew assembleDebug`。一个 APK 适用于任意部署：
服务器地址是运行时的用户输入，而非构建常量。

## 测试

- Web 侧逻辑（已存地址跳转、校验、连接）位于 `www/app.js`；URL 校验有
  单元测试（`apps/mobile/tests/validate.spec.ts`）。
- 构建期：`./gradlew assembleDebug` 必须产出可安装的 APK。
- Release APK 与桌面安装器一同作为 GitHub Release 资产发布。

## 备选方案

- **在手机上捆绑 harness**：否决，Node 运行时与原生模块在 iOS 上完全无法
  交付，在 Android 上是维护陷阱；GUI 还需要宿主的动态注入。
- **静态捆绑前端 dist**：否决，外壳需要宿主组合的 `window.__DSH_BOOT__`
  图、插件 bundle 与 `/api`。
- **只做远程地址 WebView 而不要设置页**：否决，服务器地址是部署相关的
  用户输入，不应是构建常量。
- **React Native / Flutter 外壳**：否决，Capacitor 以最少的新代码复用
  完全相同的 Web 资产。

## 后果

**买到的**：任意 harness 部署都有一个可安装的 Android 客户端；服务器地址
是首启配置；`www/` 中的 Web 资产保持平台无关，可复用于未来的 iOS 构建。

**付出的**：应用内无法更改已保存的地址（清除应用数据代替）；应用自身不
提供认证层，服务端保护（私有网络或认证代理）是必须的；构建需要本机 JDK
+ Android SDK 工具链，README 中已记录。
