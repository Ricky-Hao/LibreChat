# 重访运行会话的自动滚动

状态：`keep`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

区分显式发送与恢复 submission identity，保留导航 readiness、手动 detach 和 history replacement 后的 bottom-follow。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [b8d56b3713ba50344bff7d1503b4706962a44782](https://github.com/Ricky-Hao/LibreChat/commit/b8d56b3713ba50344bff7d1503b4706962a44782)
- [6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52](https://github.com/Ricky-Hao/LibreChat/commit/6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52)
- [be48a953543b16fff974e395a2b455c99cffaede](https://github.com/Ricky-Hao/LibreChat/commit/be48a953543b16fff974e395a2b455c99cffaede)

按当前 chat 接口维护。历史替换的滚动逻辑不要求整个 history-window 协议。

本基线实现与回归入口均在 `packages/chat/src/react/messages/`。保留上游对象输入接口，由调用方传 navigation、发送状态、readiness 和偏好，不引入应用 Provider 或 Jotai 依赖。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only autoscroll --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：scrolling hook focused、chat 类型检查与运行会话浏览器合同通过。项目门禁汇总见[根 README](../../README.md#验证)。
