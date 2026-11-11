# 外部任务回调与 PTC bridge

状态：`feature`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

注册工具、owner/tenant/anchor 绑定、终态持久接收、幂等、过期、child-context 拒绝、清理及原会话续接组成同一能力。PTC bridge 同时保留 opt-in/tool 绑定、SDK inner-call identity、可信 host context 和 trace 脱敏。marker 不授予权限。

依赖：[ptc-errors](../ptc-errors/README.md), [summary-checkpoints](../summary-checkpoints/README.md)

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [cabb5dd05d831bf4299bdcbdfd689785e612da7d](https://github.com/Ricky-Hao/LibreChat/commit/cabb5dd05d831bf4299bdcbdfd689785e612da7d)
- [f0a74c181b2168274b9d1875f0220538072b4a4b](https://github.com/Ricky-Hao/LibreChat/commit/f0a74c181b2168274b9d1875f0220538072b4a4b)
- [0b9de15cac608822851a1da7d51513449ea64b56](https://github.com/Ricky-Hao/LibreChat/commit/0b9de15cac608822851a1da7d51513449ea64b56)
- [d30572a8d50af181f1f211596e492d9c811c16ad](https://github.com/Ricky-Hao/LibreChat/commit/d30572a8d50af181f1f211596e492d9c811c16ad)
- [25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1](https://github.com/Ricky-Hao/LibreChat/commit/25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1)

direct 与 PTC 共享注册、持久化和可信上下文，合为一组。基线 retry helper 已同源，本组只保留 callback index 调用方。应用指南为 docs/task-callbacks.md 与 agents/triggers/README.md。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only task-callbacks --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
