# MCP 图片的模型输入与展示

状态 `keep`。应用基线 `d4e85d2205c78413ee27d631d7e3b7313556f21d`。

视觉 provider 的 MCP 图片随工具结果送入下一次模型请求。未知 provider 和未启用 MCP 图片输入的 provider 通过附件回调交付图片给 UI。

依赖 [sdk](../sdk/README.md)。合同使用应用实际安装的 SDK 验证工具调用。

## 同轮按需读回

应用配置 `endpoints.agents.mcpImageRead` 接受布尔值，默认关闭。设为 `true` 时，能力仅用于普通前台根 Agent 的 `NewAPI` / `gpt-6.2-sol` / OpenAI Responses。有效 fallback、checkpoint、审批、委托、已知模型追踪和 Responses 续接配置会停用读回。关掉开关即可让新执行回到原有图片路径。

受权 MCP 返回内联 PNG、JPEG 或 WebP 时，原图片照常进入首次投影。可用的原工具结果带 `img_` 短引用。普通后继工具轮仅保留引用和工具配对。模型调用 `read_image` 选择一张后，同一次执行从根图原结果取图。选中图进入紧接的结构化 Responses 请求，并与读回调用及原工具调用分别配对。选择超出预算时模型收到 `image_omitted`。源消息删除、执行结束或换轮后，原引用不可用。

这一组负责来源身份、普通聊天准入和宿主测试。SDK 的 `tool-image-read` 组负责作用域、原状态读图和预算。读回沿已授权的 provider 投影，附件仍由原 MCP 回调交付。可继续使用本页的图数和配对诊断，测试的原字节比对在内存完成。[设计与验收](../../docs/mcp-image-on-demand.md)

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
原有载荷按 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b) 的净差异归组。
主要行为与后续修正追溯：

- [3901f87f3dad8b87a60599e61fc3a76581750f40](https://github.com/Ricky-Hao/LibreChat/commit/3901f87f3dad8b87a60599e61fc3a76581750f40)

固定基线包含上游 [#18000](https://github.com/LibreChat-AI/LibreChat/pull/18000) 的替代提交 `9554046d5a2d36f120f87766ffffcf08b0bc7042`。单独和嵌入的 MCP 图片复用 `imageAttachments` 与 `getImageAttachmentContent`，由 Agent 和 Responses 附件回调交付。已知视觉 provider 保留模型图片内容。载荷继续过滤未知 provider 回退文本中的内联图片字节，校验支持格式，并覆盖 parser、真实 SDK 调用和 host 持久化。

PR16 后续修复处理 Agent 执行时重载 MCP 工具的 provider。Agent 初始化会为 `NewAPI` 等自定义端点解析实际模型 provider，执行时的工具加载会读取原始端点名。初始化结果现在经 `loadToolsForExecution` 传给 MCP 工具，调用仍可通过 `metadata.provider` 显式覆盖。模型端点、模型和 API 模式由原有初始化配置决定。

## Responses 请求诊断

沿用 `OPENAI_LOG=debug`，应用的 OpenAI SDK 日志钩子仅输出结构化诊断。使用 `CONSOLE_JSON=true` 时，在允许 `info` 的控制台日志里按 `message` 筛选以下事件。

- `mcp.tool.image` 来自 OpenAI 兼容工具结果的原始 MCP 图像块。`tool_name` 是 MCP 工具名。正常 Agent 工具调用带 `call_id`。`mcp_image_index` 和 `mcp_image_count` 表示这次工具结果中图片的顺序和总数。
- `openai.responses.request` 是 SDK 每次尝试发送 Responses 的摘要。`model`、`tool_call_ids` 和 `input_image_count` 保留原有含义。`recent_tool_call_ids` 单列最后五个工具输出的调用 ID，避免长历史触发 Winston 数组截断时丢失最新 ID。无图请求的 `input_image_count` 为 `0`。`input_image_omitted_count` 是计数中缺少逐图记录的块数。`input_item_count` 统计发送前的顶层输入项，字符串输入计为一项。`has_previous_response_id` 只记录是否有非空 ID。`store`、`stream` 只记录显式布尔值，`truncation` 只记录 `auto` 或 `disabled`。这些字段描述发送参数，服务端实际保留和截断仍需独立证据。
- `openai.responses.input_image` 来自 SDK 组装好的发送输入。`container` 为 `input.content` 时带真实消息 `role`，为 `function_call_output.output` 时带该输出的 `call_id`。`input_index` 和 `part_index` 从零开始，对应输入项和该容器内的内容块。`detail` 只记录 `auto`、`low`、`high` 或 `original`。`sdk_request_log_id` 将逐图记录关联到同一 SDK 发送尝试的摘要。
- `openai.responses.http_attempt` 使用同一 `sdk_request_log_id`，记录可用的 HTTP `status`、`duration_ms`、`retrying` 和规范化的 `outcome`。`response_headers` 表示 SDK 已收到成功响应头。`http_error`、`connection_error`、`timeout` 和 `aborted` 表示 SDK 报告错误或调用方在 SDK 报告结果前取消。终止的 HTTP 错误耗时可能包含 SDK 读取错误响应的时间。SDK 重试有独立 ID，发送摘要的 `retry_of_sdk_request_log_id` 指向它报告的首个尝试。上层模型重试由上层发起，SDK 不提供这条关联。

收到成功响应头时，流可能尚未发送数据。现有模型完成回调提供模型运行级用量，缺少 SDK 尝试 ID。逐尝试日志的证据止于 HTTP 边界，流结束状态、逐尝试 token 用量和上游实际使用哪些图片仍需独立证据。

两处逐图记录共用相同字段。`source` 为 `inline`、`url`、`file` 或 `unknown`。内联图记录规范化的 `declared_mime`、可识别的 `detected_mime` 和 Base64 解码所得的 `encoded_bytes`。读取图片头后，`header_readable=true`，`width` 和 `height` 为编码图的像素尺寸，`sha256` 取 Base64 解码所得的原始图片编码字节。`status=decoded` 表示 Sharp 完成像素解码。若头部可读且像素解码失败，记录 `pixel_decode_failed`，并保留可用于比对原字节的指纹。

每次工具结果和每次出站尝试各取顺序最后四个可定位图片块。诊断在发送路径之外运行，最多检查每图 10 MiB 编码字节。完整像素校验限单帧、`4096 × 4096` 像素总数和 Sharp 一秒解码超时。`byte_limit`、`pixel_limit`、`multiple_frames` 表示超出诊断范围。`malformed_base64`、`malformed_data_url`、`missing_source`、`unknown_source`、`unknown_format`、`header_unreadable` 和 `diagnostic_error` 标明无法确认的阶段。`external` 只记录引用类别。诊断不读取 URL 或文件，也不记录图像数据、地址或请求内容。

验收时，在获授权的环境使用含已知视觉标记的合成图。按截图的 `call_id` 找到 `mcp.tool.image`，用日志已有的 `request_id` 和摘要的 `recent_tool_call_ids` 找到后续发送，再用 `sdk_request_log_id` 找到逐图记录。两处都有相同的 `sha256` 才确认编码字节相同。核对 MIME、尺寸、字节数、容器及解码状态。缺少逐图记录时先检查 `input_image_omitted_count`。确认字节后，单独验证模型能否识别已知标记。

## 维护与验证

先读当前调用方和 [行为映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only mcp-images --tier all --plan
```

`api/server/services/Endpoints/agents/mcpImages.spec.js` 走应用 Agent 的直接工具入口。它用合成数据模拟纯图、Photo 图文和纯文本 MCP 结果，使用 vendored SDK 向 `NewAPI` 的 loopback 模拟发出两次请求。测试将 MCP 原图和实际第二次 `POST /v1/responses` 中的图与两处日志逐项比对。额外的 loopback 请求覆盖长历史、用户图、工具输出容器、截断图、无效 Base64、缺失来源和外部引用。原生 OpenAI 用同一路径作对照。Moonshot 的 Chat Completions 请求验证附件回退，未知 provider 在 MCP 工具调用边界验证显式覆盖。

同一测试通过应用配置和 OpenAI SDK 6.49.0 验证请求形状、429 重试、HTTP 拒绝、连接断开、调用方取消、日志门控和脱敏。服务端先发送 200 响应头，等测试核实尝试日志后才发送完成事件和合成用量，或发送流内错误。两个流结果的 HTTP 边界记录相同。

按需读回合同在同一入口再跑 `0 → 1 → 0 → 1 → 0`，检查模型可见引用、PNG 原字节、各次配对、下一用户轮的拒绝和读回事件、日志与附件回调的载荷。SDK 定向合同覆盖并行图顺序、重复选择、源删除和预算省略。

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11 在上一轮基线通过本组 2 项 focused 与 API 类型检查，覆盖 parser 和主机消费方。[历史验收](../../README.md#历史验收2026-11-11)
