# Agent Note: 不依赖安全上下文的草稿附件 ID（ui-conversation）

Status: implemented

English | [中文](2026-08-20-secure-context-free-draft-ids.zh.md)

## 问题

Web GUI 在 `http://127.0.0.1` 与 `http://localhost`（安全上下文）上运行正常，
但手机经普通 http 在私有地址访问同一宿主（`http://100.71.130.70:3080`，
经移动端反向代理）时，启动即崩溃并报 `crypto.randomUUID is not a function`：
浏览器只在安全来源上暴露 `crypto.randomUUID()`，而
`dsh-client-ui-conversation` 的附件草稿代码直接调用了它。

## 决策

`ui-conversation/src/client/random-uuid.ts` 基于 `crypto.getRandomValues()`
（浏览器在不安全来源上也会暴露）生成 RFC 4122 v4 UUID，`service.ts` 用它生成
草稿附件 ID。该工具镜像 `dsh-client-connection` 既有的线缆关联 `randomUuid`
——它早已证明了这一需求的必要性；跨包导入其他插件的内部实现被禁止，因此这
五行实现留在本包内。不改变任何公开导出：工具仅包内可见。

## 测试

- 单元：`packages/client/ui-conversation/tests/random-uuid.client.spec.ts`
  断言 v4/variant 格式与唯一性。
- 套件：`pnpm run test:gui` 全绿；客户端聚合类型检查通过。
- 前端 dist 已重建，面向手机的服务端已用新产物重启。

## 后果

**买到的**：GUI 能在私有（Tailscale/局域网）网卡上以普通 http 启动——这是
移动端部署在没有证书时唯一的可达方式；草稿附件在不安全来源上可用。

**付出的**：一份五行 UUID 工具的第二份拷贝（跨包导出规则禁止共享
connection 包的实现）；仅此而已。
