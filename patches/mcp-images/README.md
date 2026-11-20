# MCP 图片的模型输入与展示

状态 `keep`。应用基线 `d4e85d2205c78413ee27d631d7e3b7313556f21d`。

视觉 provider 的 MCP 图片随工具结果送入下一次模型请求。未知 provider 和未启用 MCP 图片输入的 provider 通过附件回调交付图片给 UI。

依赖 `sdk`。合同使用应用实际安装的 SDK 验证工具调用。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
原有载荷按 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b) 的净差异归组。
主要行为与后续修正追溯：

- [3901f87f3dad8b87a60599e61fc3a76581750f40](https://github.com/Ricky-Hao/LibreChat/commit/3901f87f3dad8b87a60599e61fc3a76581750f40)

固定基线包含上游 [#18000](https://github.com/LibreChat-AI/LibreChat/pull/18000) 的替代提交 `9554046d5a2d36f120f87766ffffcf08b0bc7042`。单独和嵌入的 MCP 图片复用 `imageAttachments` 与 `getImageAttachmentContent`，由 Agent 和 Responses 附件回调交付。已知视觉 provider 保留模型图片内容。载荷继续过滤未知 provider 回退文本中的内联图片字节，校验支持格式，并覆盖 parser、真实 SDK 调用和 host 持久化。

PR16 后续修复处理 Agent 执行时重载 MCP 工具的 provider。Agent 初始化会为 `NewAPI` 等自定义端点解析实际模型 provider，执行时的工具加载会读取原始端点名。初始化结果现在经 `loadToolsForExecution` 传给 MCP 工具，调用仍可通过 `metadata.provider` 显式覆盖。模型端点、模型和 API 模式由原有初始化配置决定。

## 维护与验证

先读当前调用方和 [行为映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only mcp-images --tier all --plan
```

`api/server/services/Endpoints/agents/mcpImages.spec.js` 走应用 Agent 的直接工具入口。它以同一张合成 PNG 模拟纯图和 Photo 图文 MCP 结果，用 vendored SDK 向 loopback 端点发出两次请求，检查第二次 `POST /v1/responses` 的 `input_image`、工具调用 ID 和图文文本。原生 OpenAI 用同一路径作对照。Moonshot 的 Chat Completions 请求验证附件回退，未知 provider 在 MCP 工具调用边界验证显式覆盖。

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11 在上一轮基线通过本组 2 项 focused 与 API 类型检查，覆盖 parser 和主机消费方。[历史验收](../../README.md#历史验收2026-11-11)
