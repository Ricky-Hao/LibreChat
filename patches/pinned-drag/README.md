# 固定会话拖拽顺序

状态 `local`。应用基线 `d4e85d2205c78413ee27d631d7e3b7313556f21d`。无补丁依赖。

固定基线包含上游快速放置修正 [#18087](https://github.com/LibreChat-AI/LibreChat/commit/cbd4cbb5fb1589d1d6e5b0fe7b13fbe532f3dd33)。本轮 Chromium 回归中，同类会话拖拽已在侧栏换位，放置时的 `/api/user/settings/pinned-order` 却写入旧顺序。

[changes.patch](changes.patch) 保留已发生但尚未提交的拖拽顺序。React 可以在 hover 的状态更新生效前先渲染一次，这次渲染原先会用旧顺序覆盖拖拽 ref。复用现有 `hasReorderedRef` 防止覆盖。顺序持久化继续使用原有接口及合并逻辑。

当固定上游能在相同时序下持久化新顺序时，可替换此载荷。[测试合同](tests.json) 覆盖渲染抢先、快速放置及原有排序规则。真实浏览器中的同类换位与跨类型拒绝由 [test-adaptations](../test-adaptations/README.md) 覆盖。
