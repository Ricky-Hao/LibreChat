# 内部文件与交付附件指引

状态：`local`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

为模型提供简洁 workspace/scratch/delivery 指引，区分内部工具文件与交付附件。

依赖：[sdk](../sdk/README.md)

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [0728119adf47df64f0856491559f9554fc1d6012](https://github.com/Ricky-Hao/LibreChat/commit/0728119adf47df64f0856491559f9554fc1d6012)
- [25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1](https://github.com/Ricky-Hao/LibreChat/commit/25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1)

这是模型指引，不是 collector 或秘密隔离保证；不能仅为它保留完整 fork SDK。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only file-guidance --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
