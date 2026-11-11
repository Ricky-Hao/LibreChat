# 工具 intent 标签长度与移动端换行

状态：`local`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

标签长度是 fork 体验选择；窄屏优先呈现 intent。保留上游 timing/error UI，不与 schema-aware invocation 混为一项。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [1913b7554ba8c5ed0f0c8196f112707de1038ab7](https://github.com/Ricky-Hao/LibreChat/commit/1913b7554ba8c5ed0f0c8196f112707de1038ab7)
- [bd9896574885ab6b15d6fdf79b7ca61c307045c7](https://github.com/Ricky-Hao/LibreChat/commit/bd9896574885ab6b15d6fdf79b7ca61c307045c7)
- [de74401aceb39e7551b72fa3463a86905552ae6a](https://github.com/Ricky-Hao/LibreChat/commit/de74401aceb39e7551b72fa3463a86905552ae6a)

可单独放弃标签偏好；不因此移除 PTC 调用正确性。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only intent-labels --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
