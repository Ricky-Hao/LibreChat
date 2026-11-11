# 来源与许可证

应用上游为 [LibreChat-AI/LibreChat](https://github.com/LibreChat-AI/LibreChat)，fork 为 [Ricky-Hao/LibreChat](https://github.com/Ricky-Hao/LibreChat)。本分支按最终源码净差异提取，保留标准 Git diff 与相关测试，主要来源见各组 README。

| 用途 | 固定提交 |
| --- | --- |
| 当前应用基线，固定 upstream main | `e6567c7a681ce67869dce31486a21d3a25d6931b` |
| 原始 fork 提取基线 | `f4154b649efa37e1345ccc517a4d8d1ed2178c82` |
| 完整 fork 源，含 PR #14 的 SDK 消费方修正 | `38c026db83d0ca12a067083b5c1551c1bca2754b` |
| 独立维护文档来源 | `2e79586e547131de06494bed2f3274f4745ca435` |
| 当前 SDK 源，Ricky-Hao/agents | `1559d8661120b77acd7a6189bf5ba24b82cf6f50` |
| SDK 上游 v4.2.2 基线 | `7ea84fc4db98ec9cf373b6927a3cee9549661f28` |

SDK `4.2.2-ricky.1` 的源 tree 为 `11535ca225857425e7253d428f8cbfcc4e450ccd`。当前 tarball SHA256 为 `57e3622cfeead811a46e6c34606d05dba016c6c873bc0185dd810b50de949368`，源码 patch SHA256 为 `6ffb7b907dcf961b5b68170146845aaa12a8e7edcbac521e2fb2d172c069d66a`。应用重放后，`vendor/agents.json`、`vendor/README.md` 与 `vendor/verify-agents.mjs` 提供准确消费和重建入口。这里未另修或重建 SDK。

独立文档来源的状态和替代证据已转入 [状态映射](docs/status.md) 与各组说明；四份能力/SDK 指南随载荷。旧 merge-sync 推荐不作为当前流程。完整排除与文档调整见 [提取记录](docs/extraction.md)。运行和维护均不依赖原文档工作树路径。

LibreChat 源码及本补丁仓沿用根 [MIT LICENSE](LICENSE)，保留 `Copyright (c) 2026 LibreChat`。SDK 同属 MIT；打包依赖保留各自许可证和声明。补丁中的原文件版权与许可证声明继续有效，本说明不替换第三方许可条件。
