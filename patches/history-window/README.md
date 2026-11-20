# 显示历史窗口、懒附件与缓存保留

状态：`feature`。应用基线：`d4e85d2205c78413ee27d631d7e3b7313556f21d`。

保留 observer admission、paging/anchor、数据库 body 排除、鉴权懒读取、共享缓存所有权及完整 export/share 调用方。显示窗口不是硬 DOM/heap 上限。

依赖：[bounded-reads](../bounded-reads/README.md)、[autoscroll](../autoscroll/README.md)。历史分页通过 scrolling hook 的 `detachFromBottom` 保持读者锚点，属于实际接口依赖。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [4d4bb575b86014fb8c6a363fa31064356fd4c8d6](https://github.com/Ricky-Hao/LibreChat/commit/4d4bb575b86014fb8c6a363fa31064356fd4c8d6)
- [6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52](https://github.com/Ricky-Hao/LibreChat/commit/6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52)
- [e6cce036926dd7afdaebd8f55a9cc8b7da944cf3](https://github.com/Ricky-Hao/LibreChat/commit/e6cce036926dd7afdaebd8f55a9cc8b7da944cf3)
- [60663053cd91cee73fb70cf3566e74f360e055b9](https://github.com/Ricky-Hao/LibreChat/commit/60663053cd91cee73fb70cf3566e74f360e055b9)

本组复用 bounded-reads 的预算与 revision 数据合同。可分责任评估上游替代，不能只保留界面而丢掉数据库投影、export/share 和编辑路径。应用指南为 docs/history-window-patch.md。

本基线将消息列表、分支提示和行选择迁至 `packages/chat`；本组沿用这些入口和 MessagesHost 的 copy/audio/activity 能力。历史窗口策略在根路由覆盖提前请求的 `ChatRecord` 和页面观察者。两者共用 `loadConversationMessages`，保留请求去重和流式缓存保护。开启自动滚动且无显式消息目标时，路由预取与页面查询均等待登录后配置。首个请求使用配置的窗口大小，`0` 仍读取完整历史。turn services 保留上游提交检查，仅补取消查询与重新生成父消息读取。完整历史导出沿用上游面积、边长和最小 pixel ratio 限制。

消费方夹具只定义一次 `useHistory`。`Record` 测试覆盖预取顺序、缓存去重及窗口未启用时的懒附件和工具预览参数。类型合同使用 `packages/chat` 的现有 `npm run typecheck`，同时检查源码和消费方测试。

Lighthouse 历史用例沿用上游纯文本制品用例的设置，在该用例启用 service worker，以验证 Sandpack iframe 中的实际附件正文。 向上翻页时，平铺列表会按位置复用行。行切换消息时先清除上一条消息的离屏标记，使锚点按当前行高定位。单测覆盖布局阶段的标记清理，浏览器用例在新增行进入视口后继续断言锚点偏移小于 3 像素。

v0.8.9 保留上游 `loadHistoryRows`。窗口 HTTP 与已鉴权的延迟正文读取在 `packages/api/src/messages/historyWindow.ts`，聊天包经 `FilesHost` 交由应用读取附件正文。

## 维护与验证

先读当前调用方和 [行为映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only history-window --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：本组 6 项 focused、5 项 types 与 14 个浏览器用例通过，无跳过；首次打开断言 24 条窗口，需要旧消息的交互先加载完整历史。导出夹具保留初始窗口外的长回复，ChatView 和 pane 测试覆盖实际 host 接线。项目门禁汇总见[根 README](../../README.md#验证)。
