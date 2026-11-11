# 前台恢复与 terminal recovery budget

状态：`keep`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

保留 frozen-OPEN 恢复、attachment/epoch fence、缺失与读取失败的区分、online rearm，以及默认/自定义/零预算和已有 stream 上的晚到策略。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [8d756ef9be13e0f1ff003a972bd26d723761ea57](https://github.com/Ricky-Hao/LibreChat/commit/8d756ef9be13e0f1ff003a972bd26d723761ea57)
- [26c639c9dabec567c43daa3c51b4c3a955c9613a](https://github.com/Ricky-Hao/LibreChat/commit/26c639c9dabec567c43daa3c51b4c3a955c9613a)
- [6fde23d2d169c2c00f2994a739bd68bb7d17c938](https://github.com/Ricky-Hao/LibreChat/commit/6fde23d2d169c2c00f2994a739bd68bb7d17c938)
- [89aa72fdd4bf2772ddcb9696c99fcc96647ef6c4](https://github.com/Ricky-Hao/LibreChat/commit/89aa72fdd4bf2772ddcb9696c99fcc96647ef6c4)
- [fbfdd65892795a4d1f2c5509e8503ffe68917ad0](https://github.com/Ricky-Hao/LibreChat/commit/fbfdd65892795a4d1f2c5509e8503ffe68917ad0)
- [c91134d292b56889925c937c6eedb27cbb4f48c7](https://github.com/Ricky-Hao/LibreChat/commit/c91134d292b56889925c937c6eedb27cbb4f48c7)

上游 reconnect 只覆盖部分合同；旧 PR 固定 MAX_RETRIES 不能替代配置与晚到策略。恢复及预算共用 resumable 状态机，合为一组。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only stream-recovery --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：本组 5 项 focused 与 4 项 types 合同通过；更新后的 streaming 浏览器回归也在 test-adaptations 合同中通过。项目门禁汇总见[根 README](../../README.md#验证)。
