# 显示历史窗口、懒附件与缓存保留

状态：`feature`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

保留 observer admission、paging/anchor、数据库 body 排除、鉴权懒读取、共享缓存所有权及完整 export/share 调用方。显示窗口不是硬 DOM/heap 上限。

依赖：[bounded-reads](../bounded-reads/README.md)

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [4d4bb575b86014fb8c6a363fa31064356fd4c8d6](https://github.com/Ricky-Hao/LibreChat/commit/4d4bb575b86014fb8c6a363fa31064356fd4c8d6)
- [6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52](https://github.com/Ricky-Hao/LibreChat/commit/6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52)
- [e6cce036926dd7afdaebd8f55a9cc8b7da944cf3](https://github.com/Ricky-Hao/LibreChat/commit/e6cce036926dd7afdaebd8f55a9cc8b7da944cf3)
- [60663053cd91cee73fb70cf3566e74f360e055b9](https://github.com/Ricky-Hao/LibreChat/commit/60663053cd91cee73fb70cf3566e74f360e055b9)

本组复用 bounded-reads 的预算与 revision 数据合同。可分责任评估上游替代，不能只保留界面而丢掉数据库投影、export/share 和编辑路径。应用指南为 docs/history-window-patch.md。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only history-window --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
