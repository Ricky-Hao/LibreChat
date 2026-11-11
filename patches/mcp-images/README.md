# 未知 provider 的 MCP 显示图片

状态：`awaiting-upstream`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

保留未知 provider 的图片到附件持久化回调，避免 UI 图片丢失。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [3901f87f3dad8b87a60599e61fc3a76581750f40](https://github.com/Ricky-Hao/LibreChat/commit/3901f87f3dad8b87a60599e61fc3a76581750f40)

上游 #18000 已合入 dev，PR head 为 b8f7c5d2b97557ed85a71027c933f61c33bd806a（不是 merge SHA）。目标确含时采用 display-only imageAttachments，不声明未知 provider 支持 vision。fallback 模型文本的 base64 膨胀仍未解决；#17569 已完成。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only mcp-images --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：本组 2 项 focused 与 API 类型检查通过，覆盖 parser 和必要主机消费方。固定基线仍需本地载荷。项目门禁汇总见[根 README](../../README.md#验证)。
