# 现有测试合同的适配

状态：`local`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

保留 pinned drag 测量与 pagination 对齐、sender-seen/unread 时序、stream budget/recovery、activity fold 和滚动 fixture 的最终修正。

依赖：[history-window](../history-window/README.md), [intent-labels](../intent-labels/README.md), [stream-recovery](../stream-recovery/README.md)

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [0f4e879e8621c3700811baeb4282739f9b863c6e](https://github.com/Ricky-Hao/LibreChat/commit/0f4e879e8621c3700811baeb4282739f9b863c6e)
- [306a7c14b7a378ddb53818dfb8cfe13461fb2dbf](https://github.com/Ricky-Hao/LibreChat/commit/306a7c14b7a378ddb53818dfb8cfe13461fb2dbf)
- [60663053cd91cee73fb70cf3566e74f360e055b9](https://github.com/Ricky-Hao/LibreChat/commit/60663053cd91cee73fb70cf3566e74f360e055b9)
- [c91134d292b56889925c937c6eedb27cbb4f48c7](https://github.com/Ricky-Hao/LibreChat/commit/c91134d292b56889925c937c6eedb27cbb4f48c7)
- [8e4f5049377b9f6dd095f9e3d0bfba87be5ce805](https://github.com/Ricky-Hao/LibreChat/commit/8e4f5049377b9f6dd095f9e3d0bfba87be5ce805)
- [ab2bdba833ceba7237130bb94335a8043ff6cfd7](https://github.com/Ricky-Hao/LibreChat/commit/ab2bdba833ceba7237130bb94335a8043ff6cfd7)
- [de74401aceb39e7551b72fa3463a86905552ae6a](https://github.com/Ricky-Hao/LibreChat/commit/de74401aceb39e7551b72fa3463a86905552ae6a)
- [3ef4373469dd15f5b0bf143548db6f93862e6f13](https://github.com/Ricky-Hao/LibreChat/commit/3ef4373469dd15f5b0bf143548db6f93862e6f13)

仅保留最终净差异，不逐个重放过期 fixture 提交；依赖当前实际测试消费的 history、intent 与 recovery 合同。

本基线保留当前 activity-fold 断言；上游 `0491d60ae6ae6c6606ea87d03a192968a185125c` 已删除 path 高亮调用和旧布局夹具。pinned helper 沿用 `scrollIntoView({ block: 'nearest' })`，等待 draggable 并在 hover 后检测命中，起拖后滚动再测量目标。unseen-replies 等 sender acknowledgment 后离开会话，再恢复 unread 夹具。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only test-adaptations --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：本组浏览器合同 47 个用例通过，无跳过或重试，包含完整 activity-fold、pinned drag、unseen-replies 与 streaming 回归。项目门禁汇总见[根 README](../../README.md#验证)。
