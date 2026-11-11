# 编辑前缀、fold 决策与恢复

状态：`keep`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

一起保留服务端 capture/admission、provenance、恰好一次投影、fold 三态和 multipart/index/phase 语义；覆盖正常 final、断线、prefix-only、stop/error 和 approval continuation。

依赖：[stream-recovery](../stream-recovery/README.md), [summary-checkpoints](../summary-checkpoints/README.md)

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [a73e4692c7ab4a711de33583c9069fbca497e7ab](https://github.com/Ricky-Hao/LibreChat/commit/a73e4692c7ab4a711de33583c9069fbca497e7ab)
- [a2ce7b2cbe9cb0b13d8aed232d57ad7831f9b490](https://github.com/Ricky-Hao/LibreChat/commit/a2ce7b2cbe9cb0b13d8aed232d57ad7831f9b490)
- [25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1](https://github.com/Ricky-Hao/LibreChat/commit/25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1)
- [abf01b00b567e9be85fd07aa83fa031c5b44c4f3](https://github.com/Ricky-Hao/LibreChat/commit/abf01b00b567e9be85fd07aa83fa031c5b44c4f3)

上游 reducers 与传输设施不足以替代 capture 和 fold 合同。不可只保留 UI 合并而丢掉服务端信任边界。

本基线保留上游 manual compaction 恢复：先在 generation-local 快照执行 `restoreSummaryState`，再合并保留前缀，避免索引偏移丢失 `summarizing`。上游已移除 activity path 高亮调用，本组不恢复失去调用方的 boundary-offset helper。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only retained-prefix --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：本组 5 项 focused、4 项 types 与 3 个浏览器用例通过，覆盖编辑前缀、恢复与 fold。项目门禁汇总见[根 README](../../README.md#验证)。
