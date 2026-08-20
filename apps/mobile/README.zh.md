# dsh-mobile — DeepSeek Harness GUI 的 Android 客户端壳

`dsh-mobile` 是一个轻量 Android 应用：Capacitor WebView 连接**远程
`dsh web` 服务器**并全屏显示其 GUI。它不包含任何 harness 运行时——GUI 无法
以静态方式提供，因为宿主注入 `window.__DSH_BOOT__`、提供
`/plugins/*/client.js`，并拥有 `/api`。

首次启动时应用显示设置页；输入你的服务器地址（例如
`https://your-server.example`，或 Tailscale/局域网地址如
`http://100.64.0.1:3080`）后点击连接。地址保存在设备本地（localStorage），
清除应用数据前一直复用。

## 安全

远程服务器可以执行代码，因此只连接你自己控制的服务器，并优先通过
Tailscale 或 VPN。桌面版的
[Agent Note](../../.agents/notes/implemented/architecture/2026-08-15-desktop-windows-distribution.md)
描述了 harness 自身的绑定与信任围栏选项。

## 构建

```sh
pnpm install --filter dsh-mobile
pnpm --filter dsh-mobile exec cap add android     # 首次
pnpm --filter dsh-mobile exec cap sync android
cd apps/mobile/android
./gradlew assembleDebug                          # 调试 APK
```

Release 签名遵循 Capacitor/Android 标准流程（生成 keystore 后，用签名配置
执行 `./gradlew assembleRelease`）。已检入的配置让 WebView 指向用户在首次
启动时输入的任意地址，因此一个 APK 适用于任意部署。

## 已知限制与后续工作

- 更换已保存的服务器地址只能清除应用数据（系统设置 → 应用 → DeepSeek
  Harness → 清除存储）；应用内重新配置入口已列入后续。
- 应用本身没有登录流程；请在服务端做保护（认证代理或私有网络）。
- iOS 暂不在范围内（需要 macOS 构建主机与 Apple 开发者账号）；
  `www/` 中的 Capacitor Web 资产是平台无关的。
