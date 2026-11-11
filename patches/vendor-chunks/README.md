# 与 checkout 路径无关的 vendor chunk

状态：`upstream`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

采用固定基线已有的上游包名分类和 Windows 分隔符规范化，避免 checkout 名称误命中 vendor group。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

无载荷；工具核对 replacement.commit 已包含于应用 HEAD 后才跳过。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [26b7116e7353d648a260df86b0b2eb9d07d4a284](https://github.com/Ricky-Hao/LibreChat/commit/26b7116e7353d648a260df86b0b2eb9d07d4a284)
- [0c83d171e4f48625d504c30df28fe83541398aab](https://github.com/Ricky-Hao/LibreChat/commit/0c83d171e4f48625d504c30df28fe83541398aab)
- [60663053cd91cee73fb70cf3566e74f360e055b9](https://github.com/Ricky-Hao/LibreChat/commit/60663053cd91cee73fb70cf3566e74f360e055b9)

上游 [#17921](https://github.com/LibreChat-AI/LibreChat/pull/17921) 的 replacement commit 为 `fc3b86acbc0a5290154b25f7a0091641667cd14b`，已核为固定基线的祖先。固定基线的 `client/vite.config.ts` 在 `manualChunks` 中先规范化反斜线，再按第一层 `node_modules/` 后的包路径分类，保留嵌套依赖的上游归组规则；本地末段裁剪已移除。

替代回归入口为 `e2e/specs/mock/scenarios/vendor-chunk-paths.spec.ts`：两项 config probe 分别验证 checkout 名不影响分类，以及反斜线路径和嵌套依赖分类。合同使用实际 Playwright discovery 和执行。#15907 已被替代，#17567 已完成。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only vendor-chunks --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：两个真实 config probe 与 client 类型检查通过，替代提交祖先检查通过。项目门禁汇总见[根 README](../../README.md#验证)。
