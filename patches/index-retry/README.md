# 已同源的 index retry helper

状态：`upstream`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

固定基线已含 createIndexesWithRetry 和 retry.spec.ts，不再携带第二份 helper。task-callbacks 保留需要的索引初始化调用方。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

无载荷；工具核对 replacement.commit 已包含于应用 HEAD 后才跳过。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [0b9de15cac608822851a1da7d51513449ea64b56](https://github.com/Ricky-Hao/LibreChat/commit/0b9de15cac608822851a1da7d51513449ea64b56)

基线 utils/retry.ts 最后来源为 e2b2839375d5e8052dec4785bf3117ce27aa67dc；该提交已在固定基线祖先链，helper 与基线一致。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only index-retry --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
