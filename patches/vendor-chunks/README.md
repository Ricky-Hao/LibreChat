# 与 checkout 路径无关的 vendor chunk

状态：`awaiting-upstream`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

当前载荷按 node_modules 后的包名分类并处理 Windows 分隔符，避免 checkout 名称误命中 vendor group。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [26b7116e7353d648a260df86b0b2eb9d07d4a284](https://github.com/Ricky-Hao/LibreChat/commit/26b7116e7353d648a260df86b0b2eb9d07d4a284)
- [0c83d171e4f48625d504c30df28fe83541398aab](https://github.com/Ricky-Hao/LibreChat/commit/0c83d171e4f48625d504c30df28fe83541398aab)
- [60663053cd91cee73fb70cf3566e74f360e055b9](https://github.com/Ricky-Hao/LibreChat/commit/60663053cd91cee73fb70cf3566e74f360e055b9)

上游 #17921 已以 fc3b86acbc0a5290154b25f7a0091641667cd14b 合入，但固定基线未含。目标确含后采用上游第一层 node_modules 的嵌套归组，移除本地末段裁剪；#15907 已被替代，#17567 已完成。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only vendor-chunks --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
