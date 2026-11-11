# Skill 来源与 assistant phase

状态：`keep`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

保留 Skill source identity/version、历史版本的不确定性和 commentary/final phase；覆盖转换、聚合及 reload，避免把当前 Skill 内容冒充历史版本。

依赖：[summary-checkpoints](../summary-checkpoints/README.md)

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [2480108fafe63a19bcb9b23097d891ca1e4efb23](https://github.com/Ricky-Hao/LibreChat/commit/2480108fafe63a19bcb9b23097d891ca1e4efb23)
- [afb41df6501ef4aa14a018d669bd763741d83f92](https://github.com/Ricky-Hao/LibreChat/commit/afb41df6501ef4aa14a018d669bd763741d83f92)
- [25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1](https://github.com/Ricky-Hao/LibreChat/commit/25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1)

复用上游已具备的 provenance 基础设施，仅在完整转换与恢复路径等价后移除剩余差异。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only skill-provenance --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
