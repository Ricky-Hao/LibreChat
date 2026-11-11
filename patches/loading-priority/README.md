# 可见会话优先加载

状态：`local`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

在 useAppStartup 的 speech/model catalogs 前启动可见会话查询，沿用原 enabled 条件，不增加第二次查询。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [de74401aceb39e7551b72fa3463a86905552ae6a](https://github.com/Ricky-Hao/LibreChat/commit/de74401aceb39e7551b72fa3463a86905552ae6a)

独立于 history-window 协议。适配上游 route prefetch 后再评估保留；ChatRoute 用例覆盖导航行为，性能仍需 Lighthouse，静态顺序不能证明 LCP 改善。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only loading-priority --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：ChatRoute focused 与 client 类型检查通过。Lighthouse 项目门禁及其证据边界见[根 README](../../README.md#验证)，调用顺序本身不证明性能改善。
