# 原生移动端 overlay 关闭

状态：`feature`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

保留 CloseWatcher/Navigation API 层栈、受控/非受控 dialog、Forward history 与匹配 FINAL route sync。正常跨文档、前进及不可取消导航保持浏览器行为。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [85e6822262d195f80ed93c07b56d5c86a4420eb6](https://github.com/Ricky-Hao/LibreChat/commit/85e6822262d195f80ed93c07b56d5c86a4420eb6)
- [aa9bad60bd03eea10ca17b37eca2621713d565ee](https://github.com/Ricky-Hao/LibreChat/commit/aa9bad60bd03eea10ca17b37eca2621713d565ee)
- [20846f636a126e7e34cd1f074af0b2f818f843a0](https://github.com/Ricky-Hao/LibreChat/commit/20846f636a126e7e34cd1f074af0b2f818f843a0)
- [306a7c14b7a378ddb53818dfb8cfe13461fb2dbf](https://github.com/Ricky-Hao/LibreChat/commit/306a7c14b7a378ddb53818dfb8cfe13461fb2dbf)

不恢复旧 synthetic-history 实现；不支持原生 API 的浏览器不承诺通用 Back 拦截。sidebar-focus 替代不覆盖本组。

本基线的图片弹层与 subagent 面板已迁至 `packages/chat/src/components/parts/DialogImage.tsx` 和 `packages/chat/src/components/subagents/panel.tsx`；原生关闭增量随实际组件迁移。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only native-overlays --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：本组 2 项 focused、3 项 types 与 7 个 Chromium 浏览器用例通过；展开编辑器通过 agent form 标题区定位。Safari/Firefox 未验收。项目门禁汇总见[根 README](../../README.md#验证)。
