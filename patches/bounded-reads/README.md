# 有界 MCP 消息读取

状态：`feature`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

保留数据库 projection、wire budget、逐页授权、UTF-8 continuation、revision writes 和 DocumentDB 兼容表达式；普通 pagination/preview 不等价。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [8ba662e1110bd1154bd415a6647bec5eca9cfc79](https://github.com/Ricky-Hao/LibreChat/commit/8ba662e1110bd1154bd415a6647bec5eca9cfc79)
- [24b194b8f03fdd5ad895ef5845f517a3c4a0277b](https://github.com/Ricky-Hao/LibreChat/commit/24b194b8f03fdd5ad895ef5845f517a3c4a0277b)
- [7b872aabcf5e5107ec6e1713b32156bf8d0ed6b3](https://github.com/Ricky-Hao/LibreChat/commit/7b872aabcf5e5107ec6e1713b32156bf8d0ed6b3)
- [60663053cd91cee73fb70cf3566e74f360e055b9](https://github.com/Ricky-Hao/LibreChat/commit/60663053cd91cee73fb70cf3566e74f360e055b9)

无完整上游替代证据。历史 Lighthouse 为 NO_FCP，不能据此标性能验收通过。应用指南为 docs/mcp-message-reads-patch.md。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only bounded-reads --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
