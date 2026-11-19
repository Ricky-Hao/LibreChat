# 当前 agents SDK 与构建接线

状态：`keep`。应用基线：`d4e85d2205c78413ee27d631d7e3b7313556f21d`。

携带应用实际消费的 `4.2.11-ricky.1` tarball、源码差异、来源元数据、锁文件和 Docker 接线。`api` 与 `packages/api` 通过相对 `file:` 路径显式解析同一归档。SDK 源码由 `Ricky-Hao/agents` 维护。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 携带 SDK 与应用接线差异，路径范围由根 manifest 的 `paths` 指定。

| 项目 | 固定来源 |
| --- | --- |
| SDK 上游 v4.2.11 | `690865f925800990bc8941e15fe93741b3cbd626` |
| SDK fork 合并提交与生成源码 tree | `06ac16c17bcd7a75e79c01d57248f350b157676b` / `996688a08ea9bca1030271f79e23a14df8ad537d` |
| SDK PR #5 head | `4d56ad0acc9ec8311562f424c627cbc2eddbf743` |
| `librechat-agents-4.2.11-ricky.1.tgz` SHA-256 | `90e25b2cb8a000b32c212f6bee091f215323faa8c80955e9d2495d2822a747f1` |
| SDK 源码 patch SHA-256 | `65b0a2d8d972da001935a3df483f6b3ade85d47779839897a8201d3ea677b46b` |

归档从合并提交的干净 checkout 以 Node 24.22.1、npm 11.13.0 构建。应用 checkout 的 `vendor/README.md` 记录重建命令和 `4.2.2-ricky.1`、`4.2.1-ricky.2` 的历史 provenance。以下为旧消费接线及后续修正的 LibreChat 来源。

- [2480108fafe63a19bcb9b23097d891ca1e4efb23](https://github.com/Ricky-Hao/LibreChat/commit/2480108fafe63a19bcb9b23097d891ca1e4efb23)
- [43989aee5ca11c469492ff11edbf7d91d0c75895](https://github.com/Ricky-Hao/LibreChat/commit/43989aee5ca11c469492ff11edbf7d91d0c75895)
- [25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1](https://github.com/Ricky-Hao/LibreChat/commit/25a5ef32ffdaa44335faa0ef6f141c7a27ec57d1)

相关组继续维护 summary 成功、失败与 retained history，Skill provenance，assistant phase 和 reasoning，schema-aware intent 与 SDK inner-call identity，协议错误、rich/multimodal/file delivery，run-scoped Langfuse identity/redaction，cache usage 以及前端 reset 和 append-only 合同。

## 维护与验证

先读当前调用方和 [行为映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only sdk --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：真实 SDK 来源与导出 smoke、浏览器合同及 API 类型检查通过；继续消费原有 `4.2.2-ricky.1`。项目门禁汇总见[根 README](../../README.md#验证)。
