# MCP 消息有界读取：补丁维护与上游移植指南

## 状态与适用范围

本文记录 **2026-10-13 的 v2 三工具源码实现，配套 MCP v0.4.0 发布候选**，解释 LibreChat 为什么需要配套修改，以及未来如何按语义移植到新上游。发布/部署状态须单独核验；本指南不依赖本次任务的临时目录或聊天记录。

- LibreChat 工作分支：`feat/mcp-bounded-message-reads`；基线 HEAD：`78e40464e4df7f36f1110e7258de54f47259c8e5`。
- 配套 LibreChat-MCP 工作分支：`feat/bounded-message-reads`；基线 HEAD：`0ac84637d6eafddcc5a25520176d65f66a720243`。
- **这些是补丁之前的基线，不是实现提交。** 应通过下述 Git 历史定位两边真正的补丁提交和发布版本，不能拿上述 HEAD 作为实现的可重放提交；不在本文虚构自引用 SHA。
- 下述移植、构建、测试和发布步骤是维护 runbook，不代表对未来上游已经执行。最初文档轮次仅修改文档；本指南也随 v0.4.0 本地发布准备更新，未来上游尚未检查。
- 当前源码 MCP catalog 共 **57** 个工具，其中消息分析 reader 恰好 **3** 个；历史 v0.3.1 发布包为 56 个，不能用源码数字描述已部署服务。

### 定位真正的补丁提交

在已取得授权的本地 checkout 中，使用文件历史定位实现，而非要求某个临时任务目录存在：

```sh
# LibreChat 根目录；--follow 一次只跟踪一个路径
git log --follow --format='%H %s' -- packages/api/src/messages/reads.ts
git log --follow --format='%H %s' -- docs/mcp-message-reads-patch.md
git log --all --fixed-strings --grep='feat: add bounded MCP message analysis API' --format='%H %s'
```

`feat: add bounded MCP message analysis API` 是本次计划的 LibreChat 实现提交主题；以实际历史、变更文件与第 3 节清单核对，不能只凭主题或出现本指南的提交认定实现完整。若主题不同，按文件历史追溯。记录找到的实际 SHA、新上游 base 和移植结果；基线 `78e40464` **不是实现 SHA**。在配套 MCP checkout 中可用 `git log --follow --format='%H %s' -- src/tools/message-reads.ts` 定位实现；**确认 v0.4.0 已发布且本地已有该 tag 后**，`git rev-parse 'v0.4.0^{commit}'` 可定位发布源码，再核对其包含的实现提交。缺少历史/tag 时单独取得获取授权，不假定本地 tag 存在。

**影响的是消息读取，不是整个 conversations 或 Agents 功能。** 原有专用 `librechat_conversations_messages_list` / `librechat_conversations_messages_read` 被移除；会话资源的列举、元数据读取、创建、更新、删除等操作保持原注册，`agentsTools` 注册也未更改。MCP `src/server.ts` 的 `guardedMessageTools` 和 `src/client.ts` 的 `maxResponseBytes` / `messageReadsCapability` 按此读取路径启用保护，并非给全部资源换协议。共享 client 仍有通用 SSE 错误处理，不能把“作用域内有界保护”误写成“共享文件完全未动”。

独立 `librechat_messages_search`、通用 `api_request`、浏览器 `/api/messages` 保留原用途，**不是**本方案的有界分析路径。没有旧 reader 别名、八工具分发器或 `full` 模式。

配套仓库的 `docs/BOUNDED-MESSAGE-READS.md` 是 Agent 调用契约，`docs/MESSAGE-READ-REFERENCES.md` 是 usage 与网关证据摘要。若两仓库相邻检出，可从本仓库根目录访问 `../LibreChat-MCP/docs/`。这些是 checkout-relative 路径，不依赖某个远程分支的发布状态；本指南自身包含移植所需的核心契约。

## 1. 为什么必须配套修改 LibreChat

### 1.1 问题发生在哪一跳

旧链路可能从数据库取得整条消息及大型工具输出，LibreChat 发出大 JSON，MCP 再将其包装成文本 JSON。**已知会实施缓冲限制的位置是网关作为 MCP 上游客户端消费 MCP HTTP 响应的那一跳，不是 HTTP 请求体。** 外层 JSON 转义还可能放大消息正文。

已有只读证据与公开源码相匹配：agentgateway `v1.5.0`，源码 revision `fe6732474a96a0363dfb9822859af4e9bab360fa`。

1. [streamablehttp.rs](https://github.com/agentgateway/agentgateway/blob/fe6732474a96a0363dfb9822859af4e9bab360fa/crates/agentgateway/src/mcp/upstream/streamablehttp.rs)：成功 JSON 响应经 `response_buffer_limit`、`to_bytes_with_decompression` 后解析为 `ServerJsonRpcMessage`。
2. [compression/mod.rs](https://github.com/agentgateway/agentgateway/blob/fe6732474a96a0363dfb9822859af4e9bab360fa/crates/agentgateway/src/http/compression/mod.rs)：限制解压后的字节，超限可产生 `body exceeded buffer limit`；压缩不能绕过该限制。
3. [http/src/lib.rs](https://github.com/agentgateway/agentgateway/blob/fe6732474a96a0363dfb9822859af4e9bab360fa/crates/http/src/lib.rs)：响应 `BufferLimit` extension 可覆盖 `DEFAULT_BUFFER_LIMIT = 2_097_152`，即 **2 MiB 解码字节**。

这是匹配版本的机制和默认值，**不是已测得的事故阈值**。事故响应的实际 extension、运行时有效策略、失败 payload 大小仍未测量；配置源没有 override 也不能证明内存中的策略。原事故未复现。`-32603` 是 JSON-RPC internal error，不是 HTTP 状态码。界面截断显示与传输读取失败是两个问题，显示截断并未被证明是事故原因。本文省略私有运行时名称、标识符和所有凭据。

### 1.2 为什么几个简单办法不够

| 方案                       | 不足及本方案取舍                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP 收到完整响应后裁剪     | 已发生 LibreChat→MCP 大响应、驱动物化和 Node 分配；也无法在裁剪后可靠恢复被丢掉的内容。MCP 仍需最终保险，但不能替代数据库投影和上游发送前预算。                                                                                                                                                                                                                                                                     |
| 按消息条数分页             | 一条消息就可能有巨型 args/output/嵌套内容；`limit:1` 不是字节上界。                                                                                                                                                                                                                                                                                                                                                 |
| 复用 preview + parts       | [previews.ts](../packages/api/src/messages/previews.ts) 的 `prepareToolCallPreviews` / `previewMessagesToolCalls` 对已取得的消息生成展示预览，字符限制不是完整 wire 字节预算；[parts.ts](../packages/api/src/messages/parts.ts) 的 `readToolCallPart` 先调用 `getMessages(..., CLIENT_MESSAGE_SELECT)` 再定位 part，并返回完整 part。两者服务浏览器恢复，不能直接提供投影前置、可连续重建、版本栅栏和全包字节上限。 |
| 整条消息内容 hash          | 每个分页请求都需读/序列化全源，破坏“仅选中字段”的成本目标。改用 writer-maintained revision，明确缩小一致性保证范围。                                                                                                                                                                                                                                                                                                |
| 全局提高网关 buffer        | 只移动阈值，不能限制更大的消息或减少上游物化，且扩大每连接内存暴露。本补丁不改网关。                                                                                                                                                                                                                                                                                                                                |
| 八个专用 reader 加旧工具   | 增大 tools/list 和选择成本、重复参数；改为 list → content → read 三阶段。历史八工具/严格全 hash 方案不是当前合同。                                                                                                                                                                                                                                                                                                  |
| 保留兼容别名或静默回退全文 | 重新引入无界入口并掩盖配套版本错误；新 reader 能力不匹配即失败。浏览器旧 API 本身仍保持原合同。                                                                                                                                                                                                                                                                                                                     |

数据归属、租户、retention 和消息结构由 LibreChat 掌握，所以 **Mongo 投影、选中字段读取、游标签名和完整 HTTP JSON 的预算必须在 LibreChat 内完成**。MCP 负责更薄的严格 schema、映射、解码响应保险、脱敏后最终 JSON-RPC 预算及安全错误。

## 2. 调用链与精确合同

```text
Agent / MCP client
  → gateway（消费 MCP 响应时还有自己的解码 buffer 限制）
  → LibreChat-MCP：三个 reader，严格 start 或仅 cursor
  → JWT GET /api/message-reads/{list|content|read}
  → createMessageRequestValidation：每次重新授权
  → createBoundedMessageMethods：显式 scope + Mongo 投影/截窗
  → createMessageReadHandler：revision、UTF-8 与完整 JSON 预算
  → MCP：能力检查、decoded HTTP 上限、单一文本 payload
  → 连接凭据脱敏、最终 JSON-RPC envelope 上限
  → gateway → Agent
```

### 2.1 三工具与三路由

| MCP 工具名                   | 唯一上游路由                     | 初始参数与结果                                                                                                                                                                          |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `librechat_messages_list`    | `GET /api/message-reads/list`    | 必须 `conversationId`；可选精确 `messageId` 或时间分页选择器。返回 `{conversationId,observability,items,nextCursor}`。非精确查询另有 `consistency:"live"`。                             |
| `librechat_messages_content` | `GET /api/message-reads/content` | `conversationId` + `messageId` **或**先前 content 的 `ref`；可选 `kind`、`ancestry`、`limit`。返回 `{ref,ancestry,items,nextCursor}`；根 text 存在时有 `text:true`。                    |
| `librechat_messages_read`    | `GET /api/message-reads/read`    | 必须 content 的 `ref`；`field` 默认 `entry`，另有 `text`、`args`、`output`；除根 `text` 外必须 `index`，可选 `maxBytes`。返回 `{representation,offsetBytes,data,complete,nextCursor}`。 |

三个操作的续页都**只能传 `{cursor}`**，不可再带任何初始参数；未知字段、重复 query 值、无关选择器均拒绝。默认值只在 start 归一化，后续使用签名状态。ref 与 cursor 不互换：ref 选择某一消息版本/ancestry，cursor 继续同一操作与位置。当前 token 仍包含完整归一化 Selection，未做可选的 token 紧缩优化。

`messages_list` 默认 `timeField:createdAt`、`direction:asc`、`limit:25`、`includeContext:false`，最大 100。按指定时间戳与 `messageId`、simple collation 排序，保留所有分支和 `parentMessageId`。`from` 含边界、`to` 不含；UTC 必须包含秒，允许无小数或 1–3 位小数且以 `Z` 结尾。时间范围必须有效且 `from < to`。精确 `messageId` 返回零或一条，禁止同时给 `timeField/from/to/direction/limit`，但允许 `includeContext`。这是 live 分页，不是跨请求快照；排序字段改变可能使消息在遍历中移动。

`includeContext:true` 才在数据库选择 allowlist 中的 context measurement 字段，并在页级返回 `contextProjection:"measurements"`。每个成功 list 页（含空结果、精确结果、cursor-only 页）只返回一次会话身份及：

```json
{
  "conversationId": "CONVERSATION_ID",
  "observability": {
    "llmRequests": "not_recorded",
    "ptcInnerCalls": "not_recorded"
  },
  "consistency": "live",
  "items": [{ "messageId": "MESSAGE_ID", "parentMessageId": "PARENT_ID" }],
  "nextCursor": null
}
```

`not_recorded` 指可靠持久调用计数未记录，不是“不支持分析”，也不是零；stored usage 可缺失、不完整。身份与 observability 不逐行重复，也都计入完整响应预算。

content 每页最多扫描 `limit` 个**原始存储下标**，`kind:"tools"` 过滤后可返回空页但仍有 cursor。重复 tool-call ID 以 scope + 下标区分。`kind` 默认 `all`，不是实时生命周期事件流。页级只发一个 ref；descriptor 的 `children:{ancestry:[...],omitted:true}` 要求调用者显式请求该 ancestry。MCP 接受整数数组，HTTP 映射为逗号分隔数字路径，最多 16 层，禁止任意 Mongo 路径。嵌套 ref 不允许越出已有 ancestry 前缀；`text` 仅支持根消息，不能与 index 混用。descriptor/entry 都不递归展开子内容。

名称取实际存储的值：优先 `tool_call.name`，缺失时依次 `function.name`、`code_interpreter.name`；已存 null 不当作缺失。超过 512 UTF-8 字节的名称在 descriptor 标为 `omittedFields`，可读 public entry 恢复；不会凭类型虚构 `code_interpreter` 名字。

### 2.2 安全的合成调用示例

以下是独立 MCP 调用，所有 ID/token 均为占位符，不是可用凭据；`index:3` 仅表示假设前页确实返回下标 3：

```jsonl
{"name":"librechat_messages_list","arguments":{"conversationId":"CONVERSATION_ID","includeContext":true}}
{"name":"librechat_messages_list","arguments":{"cursor":"RETURNED_LIST_CURSOR"}}
{"name":"librechat_messages_content","arguments":{"conversationId":"CONVERSATION_ID","messageId":"MESSAGE_ID","kind":"tools"}}
{"name":"librechat_messages_read","arguments":{"ref":"RETURNED_REF","field":"output","index":3,"maxBytes":8192}}
{"name":"librechat_messages_read","arguments":{"cursor":"RETURNED_READ_CURSOR"}}
{"name":"librechat_messages_content","arguments":{"ref":"RETURNED_REF","ancestry":[3]}}
```

对应 HTTP 使用 JWT 的现有认证入口；例如 `GET /api/message-reads/content?conversationId=CONVERSATION_ID&messageId=MESSAGE_ID&kind=tools`。由 MCP client 编码 query，不能手工拼接未经编码的 ref/cursor。本指南不要求读取任何密钥。

按 `offsetBytes` 连续拼接 `data`，直到 `complete:true` / `nextCursor:null`。字符串即使看起来像 JSON 仍为 `representation:"utf8"`；对象、数组、数字、布尔和 null 为 `"json"`，只在完整拼接后解析。offset/maxBytes 以**表示内容的 UTF-8 字节**计，先于外层 JSON 转义；不是 codepoint、UTF-16 单元或模型 token。没有 `totalBytes` 全扫描。若一个 codepoint 都装不下，增大 `maxBytes` 重新开始。stale/expired 后重新发现，不把不同 revision 的片段接在一起。

entry 另带 `projection:"public-entry"`、`nestedContentOmitted:true`、`unlistedFieldsOmitted:true`；是公开投影，不是原始 BSON 的完整导出。

### 2.3 内部协议、配置、预算与错误

LibreChat 内部成功/安全错误 JSON 有 `schemaVersion:2`；handler 设置 `x-librechat-message-reads: 2` 与 `Cache-Control: private, no-store`。常量为 `MESSAGE_READS_VERSION` / `MESSAGE_READS_HEADER`。MCP 校验能力并剥离内部 schema/version 与 HTTP status/data 包装，只返回一个 `content:[{type:"text",text:...}]`，不再复制 `structuredContent`。

`librechat.yaml` 中现有配置链可承载：

```yaml
messageReads:
  responseBytes: 65536
  bodyBytes: 16384
  pageSize: 25
  tokenTtlSeconds: 3600
```

| 配置              |   默认 | 允许范围/单位                                    |
| ----------------- | -----: | ------------------------------------------------ |
| `responseBytes`   | 65,536 | 4,096–65,536，完整序列化 HTTP JSON 的 UTF-8 字节 |
| `bodyBytes`       | 16,384 | 256–32,768，单个正文表示片段的 UTF-8 字节        |
| `pageSize`        |     25 | 1–100，metadata 行或 content 源下标窗口          |
| `tokenTtlSeconds` |  3,600 | 60–86,400，签发后的秒数                          |

请求 `maxBytes` 可低至 1，但不能超过服务配置 `bodyBytes`。LibreChat 的 `fits`/`send` 测量包含 schemaVersion、identity、observability、ref/cursor、转义的完整 JSON，而非只算 `data`。MCP 再限制解码 HTTP 为 65,536 字节，脱敏后的完整 JSON-RPC envelope 为 262,144 字节。token、重复 JSON 编码和错误 envelope 都必须考虑；预算不是单条消息允许大小，也不是恒定输出大小。

| LibreChat handler 错误                   | HTTP | 调用者行为                                                       |
| ---------------------------------------- | ---: | ---------------------------------------------------------------- |
| `INVALID_REQUEST` / `INVALID_CURSOR`     |  400 | 修正参数；失效、篡改、过期、跨 principal 或错操作 token 不可继续 |
| `NOT_FOUND` / `FIELD_NOT_RECORDED`       |  404 | 分别表示不可访问/不存在，或选中字段未记录；不能据此补成空串或零  |
| `STALE_CURSOR`                           |  409 | 内容 revision 变化，重新发现/读取                                |
| `ITEM_TOO_LARGE` / `UNSUPPORTED_CONTENT` |  422 | 单项/最小片段无法适配或结构不支持；不能回退完整消息              |
| `UNAVAILABLE`                            |  503 | 安全的暂不可用错误，不转发数据库异常详情                         |

这是 handler 的错误合同；JWT middleware 的认证失败仍由现有认证层处理。MCP 用 `isError:true` 和 `{error:{code,message}}` 返回安全错误；能力缺失/不兼容为 `BOUNDED_READ_UNSUPPORTED`，client/envelope 超限为 `MESSAGE_READ_TOO_LARGE`，工具 start/混参校验可返回 `INVALID_INPUT`。不得将上游 body、stack、query、header 或 token 放进诊断回包。新增 MCP 工具日志只记录工具名、耗时、最终结果；不要为了调试添加正文日志。

## 3. LibreChat 完整语义补丁清单（18 个源/测试文件）

下面的链接指向当前文件；**符号/行为是移植锚点，行号不是合同**。未来路径改变时先找等价职责。只要等价实现经过第 8 节断言矩阵证明，本地重复实现可以适配或删除；不能仅因上游出现同名工具就删掉。

### 3.1 路由与 package wiring（5）

| 文件                                                                        | 为什么需要、关键锚点                                                                            | 移植时保留/可替换条件                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [api/server/index.js](../api/server/index.js)                               | `startServer` 挂载 `app.use('/api/message-reads', routes.messageReads)`，让普通启动入口可达。   | 保留独立 namespace 和 JWT 路由；如入口改为统一 router，在真实启动链等效挂载后可删旧接线。           |
| [api/server/experimental.js](../api/server/experimental.js)                 | experimental/cluster worker 入口同样挂载三路由，避免只在普通 server 成功。                      | 检查新上游是否仍支持该入口；只有入口退役或被统一实现覆盖才能丢掉这一处。                            |
| [api/server/routes/index.js](../api/server/routes/index.js)                 | 暴露 `messageReads` router 给两个入口。                                                         | 可随 router 注册机制移动，不能忘掉其中一个 server。                                                 |
| [api/server/routes/message-reads.js](../api/server/routes/message-reads.js) | `requireJwtAuth`、三个 GET、数据库依赖、`createMessageReadLimits`、`getCursorKey` 的 CJS 接线。 | 业务仍在 TS；保留每次 validation 和配置适配。上游依赖注入等价后可改接，不把读取算法移入 legacy JS。 |
| [packages/api/src/messages/index.ts](../packages/api/src/messages/index.ts) | barrel 导出 `./reads`，使 CJS `@librechat/api` 能取得 handler/limits。                          | 上游 package export 改制时按新出口适配；不能只有源码导出、构建包缺失。                              |

### 3.2 共享合同与配置传递（5）

| 文件                                                                                        | 为什么需要、关键锚点                                                                               | 移植时保留/可替换条件                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [packages/data-provider/src/messageReads.ts](../packages/data-provider/src/messageReads.ts) | v2 常量及 `MessageReadTimeField` / `MessageReadBodyField` / `MessageReadOperation`。               | 保留与 MCP 可验证的协议；上游有等价共享类型可合并，不能偷偷把版本改成兼容任意 API。                                                                                                         |
| [packages/data-provider/src/config.ts](../packages/data-provider/src/config.ts)             | `messageReadsConfigSchema`、`TMessageReadsConfig`、`configSchema.messageReads` 定义默认和硬上限。  | 遵从新配置机制，但须仍有校验后的默认、单位和最大值；不能只添加 YAML 文档。                                                                                                                  |
| [packages/data-provider/src/index.ts](../packages/data-provider/src/index.ts)               | 导出 `./messageReads`，跨包编译和常量引用才成立。                                                  | 上游 barrel/exports 等价时替换。                                                                                                                                                            |
| [packages/data-schemas/src/types/app.ts](../packages/data-schemas/src/types/app.ts)         | `AppConfig.messageReads?: TCustomConfig['messageReads']` 贯通服务配置类型。                        | 新 AppConfig 等价字段可取代；避免类型存在而运行时丢字段。                                                                                                                                   |
| [packages/data-schemas/src/app/service.ts](../packages/data-schemas/src/app/service.ts)     | `AppService` 将 `messageReadsConfigSchema.parse(config.messageReads ?? {})` 放入运行时 AppConfig。 | 与用户/租户配置解析对齐；只有上游服务已传播等价配置才可删。handler 的 `createMessageReadLimits` 经 `getAppConfigOptionsFromUser`，并用 `skipRuntimeAugmentation:true`，不需加载无关运行时。 |

### 3.3 处理、安全与数据库边界（6）

| 文件                                                                                                      | 为什么需要、关键锚点                                                                                                                                                 | 移植时保留/可替换条件                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [packages/api/src/messages/reads.ts](../packages/api/src/messages/reads.ts)                               | `createMessageReadHandler` / `createMessageReadLimits`、`codec`、`measurements`、`metadata`、`checkEntry`：选择器、HMAC、revision、语义与完整 HTTP 预算。            | 可分拆职责或换等价上游实现，但所有 wire/auth/一致性不变量均须有测试；不能恢复全文 hash 或 fallback。                       |
| [packages/api/src/middleware/messageValidation.ts](../packages/api/src/middleware/messageValidation.ts)   | `createMessageRequestMiddleware` 内的 `createMessageRequestValidation` / `canReadActiveJobConversation`；新增 opt-in `activeJobMessageRead`、`explicitTenantScope`。 | 新路径显式租户、active-job 精确读取；旧路由默认行为不受 opt-in 影响。上游权限系统变动是必须重新审计的冲突点。              |
| [packages/data-schemas/src/methods/messageReads.ts](../packages/data-schemas/src/methods/messageReads.ts) | `createBoundedMessageMethods`、`MESSAGE_READ_METADATA_PROJECTION`、`scope`、`descriptor`、`publicEntryProjection`；数据库前置选择与字符串截窗。                      | 等价 repository 方法可以替换；必须在 driver 返回前投影，保留数值 ancestry、同一查询 revision/data、显式 retention/tenant。 |
| [packages/data-schemas/src/methods/message.ts](../packages/data-schemas/src/methods/message.ts)           | `MessageMethods extends BoundedMessageMethods`，`createMessageMethods` 合入新方法；四个后台 claim 写点增加 `$inc:{__v:1}`。                                          | 不是通用 writer 重写；第 4 节写点逐一映射。若新上游统一 revision，避免重复递增，验证原子性后删除重复 inc。                 |
| [packages/data-schemas/src/index.ts](../packages/data-schemas/src/index.ts)                               | 导出 `BoundedMessageMethods` / `MessageReadRow` / `MessageReadScope` / `MessageReadPageInput` 类型，API 不直接依赖 Mongo 查询细节。                                  | 上游 storage 接口替换时沿用分层边界；不能把完整 ORM 文档泄漏到 API 公共合同。                                              |
| [packages/data-schemas/src/schema/message.ts](../packages/data-schemas/src/schema/message.ts)             | `messageSchema.index` 添加 `{conversationId:1,user:1,createdAt:1,messageId:1}` 与 updatedAt 版本，为列表顺序提供候选索引。                                           | 这是性能支持，不是授权或正确性代用品；上游有等价索引可不重复。需分别评估租户、collation、query plan、空间和建索引成本。    |

### 3.4 新旧路由与生产方法测试（2）

| 文件                                                                                                                                    | 为什么需要、关键锚点                                                                   | 移植时保留/可替换条件                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [packages/api/src/messages/reads.spec.ts](../packages/api/src/messages/reads.spec.ts)                                                   | 合成 Mongo + 生产方法/handler；投影、同毫秒 writer、预算、权限、cursor、历史数据测试。 | 测试框架可变，但不能用 mock 全文裁剪来替代实际查询投影断言；见断言矩阵。 |
| [api/server/routes/**tests**/messages-get-real-validation.spec.js](../api/server/routes/__tests__/messages-get-real-validation.spec.js) | 实际 router + validation，测试新 namespace、旧浏览器 GET/HEAD 与私有 child 限制。      | 新上游路由体系可适配，必须继续检查真实 wiring，不能只测独立 handler。    |

当前没有数据迁移、revision 回填或索引部署动作。旧记录允许缺失 `__v`；新增 schema index 声明不等于现网已建索引，将来启动的 autoIndex/运维策略需另外确认。上述 18 个文件是实现清单；本维护文档和索引链接另计，不属于业务补丁。

## 4. 为什么只读功能需要 revision 写路径审计

### 4.1 一致性模型

content ref/cursor 和 read cursor 的 version 由小型 identity/revision 摘要产生：文档 `_id`（incarnation）、`__v`（**missing 与 0 区分**）、`updatedAt`、`parentMessageId`、`unfinished`、`error`。不 hash 全源内容。列表 cursor 只有 live 排序位置，不提供同样的内容快照。

只用 `updatedAt` 会漏掉同毫秒写入；只用 `__v` 会混淆删后以相同 messageId/version 重建的文档。`getMessageReadContent` 在**同一单文档 aggregation** 取 revision 和选中数据，避免先查 revision、后查正文的竞态。读取后发生写入，当前响应可以仍是旧快照的片段，下一次将 stale；它不是持有到网络交付的所有权锁，也不是跨请求事务快照。

任一受支持 writer 更新使旧 ref/continuation 返回 `STALE_CURSOR`。claim-only 的私有状态变化也可能保守失效，即使公开正文没变；不要据“这字段不显示”删掉栅栏。完成标志不代表不可变：后台结果仍可结算。

### 4.2 实际 writer 与 mutation 点

以下符号都在 [methods/message.ts](../packages/data-schemas/src/methods/message.ts)，除特别注明外 `$inc` 在本补丁前已存在。本补丁只增加表中四个 claim 写点的 inc，未引入全局 Mongoose hook。

| writer / mutation 点                                                   | revision 来自哪里                                                                                    | 移植必须保留的语义                                                                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `saveMessage` → `writeMessage` 快路径                                  | `buildMessageSaveUpdate` 中 `$set` 与 `$inc:{__v:1}` 同写（已有）                                    | save/upsert、retention-on-insert、隐私 sidecar 与 provenance；不能只靠 Mongoose 对 save 的默认 version 行为。                                          |
| `writeMessage` 慢路径 → `findOneAndMergeMessageProvenance`             | CAS 成功的 `findOneAndUpdate` 中 `$set` 与 inc（已有）                                               | 合并 provenance、App snapshot admission、重试和 `_id`/revision fence，不绕过 CAS。                                                                     |
| `updateMessageText` / `updateMessage`                                  | 经 `writeMessage`（已有）                                                                            | canonical text 写入走 `unsetPrivateText` 清理；保留普通编辑的字段校验/清理，同毫秒也递增。                                                             |
| `recordMessage`                                                        | 经 `writeMessage`（已有）                                                                            | 无 UUID 校验的 record 入口也不能漏；拒绝来自普通参数的 private sidecar。                                                                               |
| `bulkSaveMessages`                                                     | ordinary `updateOne` 的 `$set` + inc；App/竞争回退经 `writeMessage`（已有）                          | `overrideTimestamp` 导入即使保留时间也须更新 revision；保留 tenant-safe bulk、计数和隐私字段剥离。                                                     |
| `saveMessage` 的 `metadata.privateText`，以及普通编辑清除 private text | 正常 `writeMessage` / save update 同步保存或 `$unset`，复用已有 inc                                  | `privacyRevision` 是另一个隐私机制，不能代替消息 `__v`；密文不能泄漏到读投影。                                                                         |
| `updateToolCallResult` → `settleToolCallResult` 的 `settleUpdate`      | 正式结算 `$inc:{__v:1}`（已有），fast/CAS 路径沿用                                                   | 保留 output/status/attachments 原子更新、去重、unfinished 返回与重试；stepless fallback 不能改错重复 call ID。                                         |
| `settleToolCallResult` 的 **claim pre-stamp**                          | `fallback == null` 且有 supplied claim 时，独立 `Message.updateOne` 设置 `resultClaim`，**新增 inc** | 必须先 claim 后 terminal settle；不能在两写之间暴露可被重复领取的终态。fallback 的 claim 与 settle 已在 CAS 内，不另做 pre-stamp。                     |
| `claimBackgroundToolResults` 的 **acquire**                            | 非 replay 的 `findOneAndUpdate` 设置 admitted parts 的 `resultClaim`，**新增 inc**                   | 保留 arrayFilters、batch/owner/task/agent/generation 限制；replay 是读取，不应硬加写。                                                                 |
| `confirmBackgroundToolResultClaim` 的 **confirm**                      | `updateOne` 设置 `resultClaim.receiptReconciled:true`，**新增 inc**                                  | owner/claim 条件和幂等恢复必须不变。                                                                                                                   |
| `releaseBackgroundToolResultClaims` 的 **release**                     | `findOneAndUpdate` `$unset` 匹配 parts 的 `resultClaim`，**新增 inc**                                | 保留 kind/claimId/batchId/taskIds 与 `onlyIfUnreconciled` 过滤、`allowMissingMessage` 语义，不能清掉继任 owner。匹配文档但公开内容未变仍可能保守失效。 |
| 删除/重建                                                              | 删除后不可读；重建 `_id` 改变                                                                        | 即使 messageId、时间、`__v` 相同，旧 ref 也不能继续。                                                                                                  |

一次逻辑 settle 可能有 pre-stamp 和 settle 两次物理写，各有自己的 revision；它们不是同一次写被重复递增。未来若 upstream 已把两者合为原子写或统一 revision 管理，应按**物理 mutation 点**重新审计，不能机械叠加旧 inc。

保证范围是这些受支持写路径。任意 raw DB 写若既不改 revision 也不改 timestamp，可能无法检测，**明确不在保证内**；不能把历史全 hash 测试的承诺挪到 v2。retention/tenant/ownership 另行在每次请求和 DB scope 重验，不以 version 是否改变为前提。新增 writer 时追到真实 `updateOne` / `findOneAndUpdate` / bulk / pipeline，而不只看外层方法名；记录它是改公开数据、改 scope，还是只改无关记录，再证明对应栅栏与授权行为。

## 5. 安全与公开投影不变量

1. **认证/授权**：router 使用 `requireJwtAuth`；handler 每次包括 ref/cursor-only 调用都调用 `createMessageRequestValidation`。先解析/验证 token 不代表已授权；必须验证后才取选中数据。
2. **租户/关系**：validation 的 `explicitTenantScope:true` 调用用户/租户 scoped `getConvo` 依赖槽位；现有 [middleware/messageValidation.js](../api/server/middleware/messageValidation.js) 实际注入 [methods/conversation.ts](../packages/data-schemas/src/methods/conversation.ts) 的 `getConvoOwnership`，只查 ownership/child 判别字段而非整个会话。DB `scope` 同时匹配 `user`、`conversationId`、可选 `messageId`。tenantless 查询为 `tenantId:{$exists:false}`，不是“不加租户过滤”；有租户精确匹配。不能仅按 messageId 找到记录就返回。
3. **retention**：消息查询显式 `activeExpirationFilter`；会话查询沿用 retention-aware `getConvo`。TTL sweeper 尚未删除不代表仍可访问。会话/消息在两页之间过期必须重新拒绝。
4. **active job**：会话尚未持久化时，现有授权 fallback 允许 owner 的 `running` 或未过期有效 `requires_action` job；`activeJobMessageRead:true` 使新精确读可走此语义。保留 `hasTenantMismatch` 的既有 legacy tenantless job 行为；实际消息读取仍必须通过上述显式 DB scope。终止、无效 pending action 或其他用户不能借 job 访问。
5. **child**：直接以 durable `subagentThread` 会话读取 GET/HEAD，表现为不可见；不能拿 child thread ID 绕过父级。inline `tool_call.subagent_content` 只能以用户可见父消息 ref、显式数字 ancestry 向下读；不是开放所有子线程。
6. **正向投影**：`MESSAGE_READ_METADATA_PROJECTION` / `publicEntryProjection` 在 DB 边界排除未列出的 trace/auth/config、private text/密文、claim/wakeup 内部数据、attachment 集合和嵌套 transcript；`checkEntry` 再拒绝畸形标量。公开 `thread_id` 不等于公开私有 trace ID。finish_reason 缺失保持缺失，不从 unfinished/error 推断 completion。
7. **签名域**：`codec` 使用现有 `JWT_SECRET`，HMAC-SHA256 前缀 `message-reads-v2\0` 做域分离，不新增密钥发现流程。token 绑定 user+tenant principal、operation、scope、有效 limits、版本/位置和过期时间，签名用 timing-safe 比较。签名不是加密：token 携带选择器但不含正文/凭据，应视作 opaque，不写日志。现有 key 轮换会使旧 token 失效，重新开始即可；缺 key 安全返回 unavailable。
8. **TTL**：签发时加配置 TTL，新 continuation 有新的有效期；过期或跨 principal 必须拒绝。token 不是 bearer 授权，不得借签名绕过每次权限/retention。
9. **数据边界**：args/output 是用户有权读取的任意工具内容，不是通用 DLP 清洗结果。MCP 的既有连接凭据 redactor 仍作用；若正文含连接自身 secret，会改变与上游 byte offset 对应的数据，因此不能承诺被脱敏 payload 仍逐字节重建。合成重建测试使用非秘密数据。
10. **安全失败**：不支持上游/结构时不落回旧全文 API；错误不回显任意异常，新增日志不包含正文或 credential。保持通用资源与浏览器合同，不给所有 API 无差别套 v2。

## 6. 成本模型：保证什么，不保证什么

| 路径                                   | 数据库到 Node 的行为                                                                                        | 仍存在的成本                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| metadata                               | `.select(MESSAGE_READ_METADATA_PROJECTION)`，非 opt-in context 不选                                         | 历史 `metadata.usage` 对象可能较大，随后 Node 的 `measurements` 才做深度/节点/叶子限制；不能声称所有 DB result 都有固定字节上界。 |
| descriptors                            | Mongo 用 `$range`/`$arrayElemAt` 在固定 ancestry 上选择有限源下标，`descriptor` 只返回小摘要                | Mongo 仍读文档/访问数组；有界的是返回窗口，不是整个 DB 执行常量时间。不把整 content 数组传到 Node 再 slice。                      |
| string body                            | `$substrCP` 在 driver 物化前最多返回 `maxBytes+1` 个 codepoint；Node 再按 UTF-8 边界和完整 wire budget 缩短 | Mongo 仍可能扫描/seek 大字符串；codepoint 数不是字节数。cursor 保存 codepoint position 与 byte offset，两者不能混用。             |
| structured args/output 与 public entry | 只返回选中 value 或公开 entry，再由 Node `JSON.stringify`                                                   | 每段仍可能 O(选中值大小) 的物化/序列化，重复请求会重复该成本；没有通用流式 JSON 引擎或缓存服务。                                  |

引号、反斜杠、控制字符在外层 JSON 中膨胀，所以预算必须检查完整 serialized response；只检查 Buffer(data) 不够。没有 descriptor body length、全文 hash 或 `totalBytes` 探测；不为获取摘要先把大 body 序列化。

因此本方案限制传输和若干读取物化路径，但不承诺端到端常量内存/CPU、所有 Mongo 操作低成本、通用 token 节省或用户可见延迟提升。新增索引是否被使用、部署数据库行为和吞吐均需单独测量。

## 7. usage 与“调用次数”的正确含义

读 API 返回已存的 measurement，不重新计费，不把消息条数变成调用次数。

- [agents/usage.ts](../packages/api/src/agents/usage.ts) 的 `aggregateEmittedUsage` 聚合**实际捕获的 emitted usage events**；`aggregateCollectedUsage` 与 `recordCollectedUsage` 服务 collected/billing/accounting 路径，不能假设全部同义。
- `metadata.usage.input` 是归一化后的非缓存 input；cache read 与 cache creation/write 分开。subset-cache provider 从原 input 扣 cached 部分，additive-cache provider 保留分别报告的 cache。output 有 provider-aware 的 total-minus-input 恢复，不能把 additive cache 算成 output。只有已捕获事件的 cost 覆盖完整才发出 cost。历史 writer 曾把未知/无效数变成 0，reader 无法恢复丢失的不确定性。
- [agents/callbacks.js](../api/server/controllers/agents/callbacks.js) 的 `ModelEndHandler`、`usageEmitSink` / `contextUsageSink` 说明事件进入聚合的路径。primary、转发 subagent、summary sink 是否完整影响覆盖；一条存储消息不等于一次模型请求。
- `recordCollectedUsage` 返回用于消息 accounting 的首个 primary input 与 primary+summary output，排除 subagent/隐藏 sequential output 的那个返回值；[BaseClient.js](../api/app/clients/BaseClient.js) 的 `tokenCount` / `getTokenCountForResponse` 历史路径还可能是文本计数。故 tokenCount 不是可靠 LLM 请求账本。
- `summaryTokenCount` / `metadata.summaryUsedTokens` 是 summary/context accounting，不应再当额外独立账单相加。`metadata.contextUsage` 是上下文窗口快照；budget、instruction、pruning、remaining、tool breakdown 等存在子集关系，不能重复求和。
- [subagentThreads.ts](../packages/api/src/agents/subagentThreads.ts) 使用 `aggregateEmittedUsage` 保存 child usage；detached child 可单独持久化，父子都相加可能重复计入已转发事件。**外部 OpenCode usage 不意味着已经包含**，没有证据就标未知。
- PTC 的 `run_tools_with_bash` 是一个存储的顶层工具调用。[callbacks.js](../api/server/controllers/agents/callbacks.js) 和 [client/store/ptc.ts](../client/src/store/ptc.ts) 的 `ptcTraceByToolCallId` / `PTC_TRACE_MAX_ENTRIES` 提供 best-effort live telemetry，不是 durable inner-call ledger。脚本/manifest 不能证明每个内调用执行过。message/step/tool/run ID 也不能代替 LLM 或 PTC 次数；不声称 `N−1` 模型节省，直接工具调用也可并行。
- `measurements` 保留安全 null、bool、有限 number、受限 numeric string/状态串、历史对象/数组；限制深度 8、节点预算 128、数值字符串 64 字符，并移除 credential/config-like key、任意 prose/不支持值，使用 `omittedFields` 标识。缺失不补 0，也不强制把旧类型转成统一账本。

未来要回答精确次数，需要独立持久事件模型、幂等 call ID、coverage marker 与计数语义；不是给这个 reader 增加推测数字。

## 8. 未来移植 playbook（未执行）

### 8.1 准备与语义映射

1. **单独取得维护者授权**后再获取未来新 upstream ref。记录新 ref 的完整 SHA、目标分支、通过上述历史定位的两仓库原始补丁提交与依赖版本。在独立干净 worktree 开始；先记录原工作树/未提交修改，绝不 broad reset、清理、无标识 stash 或覆盖用户工作。
2. 先读新上游贡献约定和现有 message endpoints、数据库接口、权限/retention、配置链、writer revision 机制。不要假设本指南的路径或未来上游缺陷仍成立；用第 3 节符号搜索映射表记录“旧职责 → 新位置/等价实现”。
3. 评估 upstream 已有实现是否同时覆盖：DB 前置 projection/string window、完整 wire 预算、每次 auth/tenant/retention、revision 同读和 writer fencing、明确 cursor-only、branch pagination、公开投影及 nested scope。**同名 endpoint/tool 或 count pagination 不是等价证据。** 有等价就最小适配/删除重复代码，无等价才移植缺失部分。
4. 在实现顺序上先定义共享合同与 storage 接口，移植 DB scope/projection、auth、writer invariants，再接配置、handler 与两个启动入口。依赖类型可先落地；不要先接公开路由后再补权限。保留 legacy 浏览器路由，不把三工具塞进旧动态 message 路由引发冲突。
5. 逐写点核对 `__v` 或替代 revision：已有统一机制就不要 double-increment；不存在则补最窄的原子 mutation。检查 bulk/import、privacy、App admission、settle/CAS、claim pre-stamp/acquire/confirm/release，不只常规 save。保留 claim ownership 和 retry 语义。
6. 数据库若改成 DocumentDB、FerretDB 或其他后端，单独验证 `$substrCP`、`$type`、`$$REMOVE`、`$arrayElemAt`、`$range`、`$map`、`$objectToArray`/`$arrayToObject`、`$mergeObjects`、collation 与 driver 行为。现有 claim writer 的兼容注释**不证明新读 aggregation 兼容**；当前仅有 Mongo 合成测试证据。未经验证不能启用或宣称兼容。
7. token key 只经已授权的现有配置/依赖注入路径；不去搜索 runtime secret、日志、cookie 或其他工作目录。若上游 token 服务变化，保留域分离、TTL、principal、scope、operation 和非授权属性，必要时有明确重新开始策略。

### 8.2 构建与最小可复现命令

以下从已安装项目依赖、具备测试 Mongo 条件的本地开发环境执行；这是当前有效配置路径，不代表已替未来上游验证。不要改测试去连生产 Mongo。测试 fixture 使用临时数据库；缺离线 Mongo 二进制等依赖时记录阻塞而不是切生产。

**先按依赖顺序构建和 typecheck**，构建完成后才开始下游消费；build 成功不等于 tsc 成功。从 LibreChat 根目录：

```sh
npm run build:data-provider
./node_modules/.bin/tsc --noEmit -p packages/data-provider/tsconfig.json
npm --prefix packages/data-schemas run build
./node_modules/.bin/tsc --noEmit -p packages/data-schemas/tsconfig.json
npm --prefix packages/api run build
NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/tsc --noEmit -p packages/api/tsconfig.json
```

最小功能验证是 bounded handler 与实际 router；移植涉及 writer/auth 时还必须运行紧接其后的 methods/privacy/background/旧路由回归：

```sh
./node_modules/.bin/jest --projects packages/api/jest.config.mjs api/jest.config.js --runInBand --coverage=false --runTestsByPath packages/api/src/messages/reads.spec.ts api/server/routes/__tests__/messages-get-real-validation.spec.js

./node_modules/.bin/jest --config packages/data-schemas/jest.config.mjs --runInBand --coverage=false --runTestsByPath packages/data-schemas/src/methods/message.spec.ts packages/data-schemas/src/methods/message.privateText.spec.ts

./node_modules/.bin/jest --projects packages/api/jest.config.mjs api/jest.config.js --runInBand --coverage=false --runTestsByPath packages/api/src/agents/backgroundClaims.spec.ts packages/api/src/agents/backgroundCompletionWakeup.spec.ts packages/api/src/agents/backgroundCompletionWakeup.integration.spec.ts api/server/routes/__tests__/messages-{content-edit,delete,feedback,get,retention,subagent-thread,update,tool-previews}.spec.js
```

当前为 Bash brace expansion；不支持它的 shell 需展开八个路径。API/data-schemas Jest config 为 **`.mjs`**，legacy `api/jest.config.js` 才是 `.js`。CAS/claim/隐私失败是移植失败，不能增加 timeout 或放宽断言来掩盖。保留失败命令与原因，再记录修正后的结果。

针对第 3 节 18 个文件做 format/lint，勿运行全库自动改写。当前可在 LibreChat 根目录复用如下 Bash 路径数组：

```sh
patch_files=(
  api/server/index.js
  api/server/experimental.js
  api/server/routes/index.js
  api/server/routes/message-reads.js
  api/server/routes/__tests__/messages-get-real-validation.spec.js
  packages/api/src/messages/index.ts
  packages/api/src/messages/reads.ts
  packages/api/src/messages/reads.spec.ts
  packages/api/src/middleware/messageValidation.ts
  packages/data-provider/src/config.ts
  packages/data-provider/src/index.ts
  packages/data-provider/src/messageReads.ts
  packages/data-schemas/src/app/service.ts
  packages/data-schemas/src/index.ts
  packages/data-schemas/src/methods/message.ts
  packages/data-schemas/src/methods/messageReads.ts
  packages/data-schemas/src/schema/message.ts
  packages/data-schemas/src/types/app.ts
)
./node_modules/.bin/prettier --check "${patch_files[@]}"
./node_modules/.bin/eslint "${patch_files[@]}"
git diff --check
```

**配套 MCP**：在相邻 LibreChat-MCP 根目录，LibreChat 相关包已构建后：

```sh
npm run check
npm test
npm run build
LIBRECHAT_SOURCE_ROOT=../LibreChat node --import tsx --test test/bounded-upstream.integration.ts
git diff --check
```

这是无需历史任务文件即可重现的跨仓库最小合同测试。它使用编译后的 package exports、生产 DB 方法、真实 handler/validation 和 SDK HTTP，不是只 mock 出一个正确 envelope。`test/message-reads.test.ts` 中 SDK discovery 验证当前三工具 schema、start/cursor 与 catalog；不需要旧设计。

`test/message-schema.integration.ts` 的历史 A/B **额外要求** `MESSAGE_READ_BASELINE_DIR` 包含当时的 `message-reads.ts` 和 `conversations.ts`，并允许 `MESSAGE_READ_SCHEMA_OUTPUT` 导出当前三个 reader 的实际 tools/list 数组。这些旧源并非本仓库依赖，也不是移植前置条件；没有可信的已归档基线就不要伪造 A/B。未来可独立归档本次已提交的 tools/list 与编译来源，用新旧已知版本比较；指标是紧凑 JSON 的 UTF-8 bytes，不是漂亮打印文件大小、模型 token 或延迟。

### 8.3 必须保留的断言矩阵

以下是当前真实测试名称/语义锚点；文件移动可适配，保证不能减弱。参数化标题中的 `%s/%p/%j` 是原测试标题。

| 必须断言                                                                                                         | 当前文件与测试锚点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| metadata DB 正向投影、context opt-in，缺失 usage/finish_reason 不造值                                            | [reads.spec.ts](../packages/api/src/messages/reads.spec.ts)：`positive metadata projection excludes bodies and opt-in context at the database boundary`；`preserves usage without invented counts: %p`；`preserves stored finish_reason without completion inference: %p`                                                                                                                                                                                                                                                                                |
| timestamp+ID ties、上下界、正反方向、所有分支                                                                    | 同文件：`pages all branches with exact ties, bounds and directions: %s`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DB 不把巨型 descriptor/string 正文全量交给 Node                                                                  | 同文件：`projects descriptor windows and string segments before Node hydration`；`does not hydrate private entry metadata or sibling/descendant bodies in the public entry result`                                                                                                                                                                                                                                                                                                                                                                       |
| Unicode、JSON-looking string、结构化值，cursor-only 精确拼接                                                     | 同文件：`reconstructs string, JSON-looking string, structured args and escaped Unicode using cursor only`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 嵌套显式访问、重复 call ID、过滤空页仍前进                                                                       | 同文件：`explicit nested scope and public entry projection exclude descendants and private fields`；`bounds source-index scanning, including empty tool pages and repeated call IDs`                                                                                                                                                                                                                                                                                                                                                                     |
| 真实 writer 同毫秒 save/edit/import/settle/claim/confirm/release/recreate 都 stale                               | 同文件：`invalidates references and cursors after supported same-ms %s`（冻结 `mongoose.now`，实际调用 methods）                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| repeated same-ms、missing revision、原子 revision/data、raw-write 排除项                                         | 同文件：`detects repeated same-ms supported edits and the missing-to-present revision transition`；`binds revision and selected data to the same atomic query despite a subsequent writer`；`documents raw database writes without revision/timestamp changes as outside the consistency guarantee`                                                                                                                                                                                                                                                      |
| user/tenant/tenantless/conversation 关系、retention、child、匿名及续页重新授权                                   | 同文件：`rechecks access for cursor-only requests: %s`，以及 wrong-user/wrong-tenant/tenantless/wrong-conversation/child 参数化组；实际 router 用 `wires bounded routes through real validation before fetching selected data`                                                                                                                                                                                                                                                                                                                           |
| token 篡改、过期、跨操作、混用 query、非法 limit/ancestry/date、重复 query                                       | 同文件：`rejects token tampering, expiration, operation confusion and mixed scope overrides`；`rejects invalid request %s %p`；`enforces configured body ceilings, rejects duplicate query values, and bounds safe DB errors`；UTC 精度两个参数化组                                                                                                                                                                                                                                                                                                      |
| 完整序列化预算含 escaping、identity、observability，exact/empty/cursor 只出现一次                                | 同文件：`fits outer JSON budgets under control-character expansion without skipping data`；`attributes every list/exact/cursor page once and budgets the complete observability envelope`                                                                                                                                                                                                                                                                                                                                                                |
| function/code-interpreter legacy name、oversize omitted/recoverable，stored null                                 | 同文件：`uses bounded stored name fallbacks, preserves direct precedence, and recovers oversized names through entry`；`supports historical tool forms, null values and public summary entries`                                                                                                                                                                                                                                                                                                                                                          |
| 新旧路由不冲突、旧浏览器 GET/HEAD、私有 child 禁止                                                               | [messages-get-real-validation.spec.js](../api/server/routes/__tests__/messages-get-real-validation.spec.js)：`serves the noncolliding list and single metadata routes with authorization and byte bounds`；`wires content and ref-only body reads, and exposes no superseded analysis routes`；`does not return messages for a directly addressed child thread`；`does not expose a directly addressed child thread through HEAD`                                                                                                                        |
| writer CAS、并发 App admission、claim 归属与 pre-stamp                                                           | [message.spec.ts](../packages/data-schemas/src/methods/message.spec.ts)：`serializes concurrent App attachment settlements under the shared BSON budget`；`leaves a concurrent %s change intact and retryable`；`atomically settles a fallback while preserving claim ownership: %j`；`stamps a supplied claim only on a part that carries none`                                                                                                                                                                                                         |
| 隐私 sidecar 原子保存、失效、retention/import 剥离                                                               | [message.privateText.spec.ts](../packages/data-schemas/src/methods/message.privateText.spec.ts)：`stores both views atomically and excludes ciphertext from ordinary and client reads`；`does not accept sidecar writes from message parameters or generic edits`；`does not return expired originals even before the TTL sweeper runs`；`strips private fields from bulk copies, including overwrites of protected rows`                                                                                                                                |
| claim rollback/确认/继任 owner、丢响应恢复，不因新 inc 破坏后台状态机                                            | [backgroundClaims.spec.ts](../packages/api/src/agents/backgroundClaims.spec.ts)：`does not report arbitration as complete if rollback fails`；[backgroundCompletionWakeup.integration.spec.ts](../packages/api/src/agents/backgroundCompletionWakeup.integration.spec.ts)：`cleans a late predecessor projection without clearing its successor receipt batch`；`resolves a committed manual confirmation whose write reply was lost`；同时保留 [backgroundCompletionWakeup.spec.ts](../packages/api/src/agents/backgroundCompletionWakeup.spec.ts) 全套 |
| MCP 三工具、57 catalog、只移除两旧 message reader、会话/Agents 注册保留，初始提示、严格 schema、UTC 与单 payload | 配套 `test/message-reads.test.ts`：`exactly three concise reader tools, strict starts/cursor-only calls and compact single payload`；`test/conversations.test.ts`；对照 `src/server.ts` / `src/tools/conversations.ts` / `src/tools/agents.ts` 的注册                                                                                                                                                                                                                                                                                                    |
| 旧/不兼容 API 安全失败、decoded HTTP 与脱敏后 JSON-RPC full-wire 上限、最终日志                                  | 配套 `test/message-reads.test.ts`：`old upstream and incompatible success schema fail closed with no fallback or diagnostic echo`；`advertised bounded response is stopped at the decoded HTTP backstop`；`post-redaction MCP envelope backstop logs only final error metadata`                                                                                                                                                                                                                                                                          |
| 编译后跨仓库实际 HTTP/DB 字节与巨型 args/output 重建                                                             | 配套 `test/bounded-upstream.integration.ts`；可选历史 `test/message-schema.integration.ts` 只测 discovery schema bytes，不替代行为测试                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 8.4 证据、独立复核与冲突决策

移植完成时记录旧补丁提交、新上游 base、最终变更清单、编译依赖版本、实际命令/退出码/测试结果及未测项；由独立 reviewer 对**最终代码**复核 auth、DB projection、writer/CAS、token 与整个 response envelope。干净 cherry-pick 不代表语义正确。冲突热点优先看 message writer（尤其 App/隐私/CAS）、tenant/retention middleware、AppConfig service、barrel/build exports、两套 server wiring 和 MCP SDK schema/JSON-RPC 包装。

遇到等价新 API 时，先通过断言矩阵证明 budgets/auth/revision/pagination/usage 全部覆盖，再最小替换；若只能覆盖一部分，保留缺失层而非盲套旧文件。新的集中 revision 机制不能与旧 claim inc 叠加；新的 router/配置服务不能只改声明而漏运行时传播。index 可因等价计划删除，鉴权过滤不可以 index 替代。

## 9. 已有验证、未测项与配套发布

### 9.1 实现复核的历史证据

- 最后窄范围实现复核通过 **117 affected cases**：65 bounded API + 9 实际 router，41 MCP，2 编译后 HTTP/schema。更早的 206 methods/private-text 与 94 background case 证据沿用；它们不是本轮重新运行，且不与历史总数相加。
- 当时依赖顺序构建/typecheck、focused ESLint/Prettier 与两仓库 `git diff --check` 通过。随后的纯文档轮次只验证文档/路径/符号及业务文件前后哈希；v0.4.0 版本/文档准备另外执行 MCP check/test/build/pack 与 SDK 握手校验，不重复 LibreChat 业务套件。
- 实际 SDK discovery：历史首版 10 reader / 10,313 bytes → 当前 3 reader / **3,876 bytes**。10 包含首版 8 工具与 2 旧 reader，不是完整 catalog；当前完整源码 catalog 为 57。
- 合成巨型 fixture：legacy HTTP 3,970,485 bytes；248 次有界请求的最大 upstream HTTP 22,279、MCP HTTP 32,721、descriptor DB result 457、string-window DB result 20,972 bytes。另一 550,000-byte 字段 fixture 的投影结果最大 1,078 bytes。这是测试 byte 测量，不是线上事件复现或所有数据的最大值。
- 先前 Lighthouse 失败为 **`NO_FCP`**，没有有效 LCP/CLS/TBT 或性能验收结论；这是历史未满足的性能验证项，不是功能成功。本轮未重跑。将来代码移植涉及启动/消息加载时按 [AGENTS.md](../AGENTS.md) 和 [Lighthouse 指南](../e2e/lighthouse/README.md) 另行复现性能门槛，保留原失败记录。

### 9.2 发布和真实目标测试的前置条件

发布与部署分别需要相应授权；源码准备和本地通过不等于已经发布，更不等于生产部署。本次版本准备由本地 writer 完成，Git 推送与发布由协调者处理；部署不属于本次准备范围。新 MCP 需要暴露 v2 能力的 LibreChat；旧 API、首版八工具 API 或不兼容 schema 对新 reader 都应 fail closed。旧 MCP 不会因 API 已部署就自动取得新三工具能力；不能宣称任意新旧组合都兼容，也不能依靠旧全文工具满足有界保证。回滚/发布顺序应以匹配组合为单位设计，能力未就绪时可用性降低但不回退无界读取。

浏览器 `/api/messages` 合同保留；不删除用户仍在用的会话操作、Agents 或泛用 API，不增加 compatibility aliases。发布前通过真实 tools/list 检查三个名称/描述与当前 catalog，核实各部署入口的 capability、配置上限和错误行为。

真实目标回测必须有**已授权现有认证入口**、配套新 API/MCP 部署、允许读取的数据范围和测试窗口；不要为测试搜取其他会话 token、容器 secret 或未授权工作目录。只读取测试范围内消息，日志/报告保存脱敏后的 byte、status、耗时和结论，不保存正文、ref、cursor 或 credential。验证多页/大字段/子 scope、实时修改后 stale、权限/retention 变化和最终网关路径；实际阈值和载入策略只能在授权范围单独确认。没有这些条件就明确写“未做 live retest”。当前部署数据库/index/performance 与事故有效阈值仍未测。

### 9.3 未来移除条件与维护清单

只有上游或替代实现经配套合同测试覆盖全部关键不变量、消费者已迁移、授权发布/回滚方案完成后，才移除本地补丁。可先删被等价 upstream 接管的配置/exports/index/revision 重复部分；不能把 security 或完整 wire budget 当成可选优化删掉。

- [ ] 两仓库真正 patch commits、新 base、协议与发布版本已记录；baseline 不冒充实现提交。
- [ ] 新 writer/新字段逐项审核 revision、公开 allowlist、retention 与 tenant。
- [ ] 同毫秒与 recreate、CAS/claim/privacy、cursor-only/混参、Unicode 与 full-wire 测试保持。
- [ ] 文档说明结构化字段成本与 usage 不确定性；无虚构 count/finish/savings。
- [ ] tools/list 恰好三专用 reader，旧 message 别名消失，会话/Agents 注册未被误删。
- [ ] 配置确实经 AppConfig 到 handler；两个启动入口与依赖构建产物可用。
- [ ] 数据库替代实现、索引计划、线上回测和性能门槛分别标明实测或未测。
- [ ] 变更经过独立代码复核；配套发布仅在单独授权后进行。
