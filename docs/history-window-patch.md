# 会话历史窗口与附件按需读取：补丁维护与 upstream 合并指南

本文说明 2026-10-19 在 [PR #6](https://github.com/Ricky-Hao/LibreChat/pull/6) 合入的显示历史补丁为何存在、由哪些代码负责，以及何时可以由 upstream 实现替换。用户行为与配置由 [Conversation display history](history.md) 维护；本文不另建一份使用契约。其他 fork 维护入口见 [文档索引](README.md)。

当前职责映射于 **2026-10-23** 按源码 `68c4a880ee28de2f8ae6009872cbb719cc65026d` 静态核对。这里列出已有源码和回归入口，不新增功能、CI 或性能通过结论。发布、部署和运行验收须分别核实。

## 1. 设计理由

补丁前，打开会话会读取完整显示历史，并随消息返回附件正文。既有工具调用预览能缩短工具参数和输出，但不会限制首屏消息条数，也不会自动排除历史附件正文。因此，用户只查看最近回复时，浏览器仍会接收和解析旧内容。

补丁把成本控制放在两个读取边界：

1. 在外围消息 observer 挂载前决定本次导航的窗口策略，避免其他消费者先发出全文请求。
2. 在数据库返回给 driver 前排除显示用文件正文，显式打开预览后再鉴权读取，并单独缓存正文。

只减少 DOM 节点不能减少这部分查询返回、传输和 JSON 解析成本。取得全文后再裁剪也已经支付了这些成本。窗口与按需正文读取分别解决消息数量和文件正文问题，不能互相替代。

## 2. 提交脉络

fork 为 `Ricky-Hao/LibreChat`，项目主分支为 `rickyhao/dev`。补丁前基线是 [`6a5abda24648efac4f71910ab355b2f5b419034f`](https://github.com/Ricky-Hao/LibreChat/commit/6a5abda24648efac4f71910ab355b2f5b419034f)。以下三个提交依次相连，日期均为 2026-10-19：

| 实现提交                                                                                                                             | 职责                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`4d4bb575b86014fb8c6a363fa31064356fd4c8d6`](https://github.com/Ricky-Hao/LibreChat/commit/4d4bb575b86014fb8c6a363fa31064356fd4c8d6) | 历史窗口、数据库轻量投影、附件按需读取、客户端缓存和配套测试。     |
| [`24b194b8f03fdd5ad895ef5845f517a3c4a0277b`](https://github.com/Ricky-Hao/LibreChat/commit/24b194b8f03fdd5ad895ef5845f517a3c4a0277b) | 移除既有 MCP reader 的 DocumentDB 不兼容表达式，保护公开投影边界。 |
| [`6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52`](https://github.com/Ricky-Hao/LibreChat/commit/6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52) | 保留历史替换后的底部跟随语义，并适配受影响的测试接线。             |

PR #6 的合并提交为 [`993d27ddb53eb50831e3b3b583e610a7d418eee4`](https://github.com/Ricky-Hao/LibreChat/commit/993d27ddb53eb50831e3b3b583e610a7d418eee4)，其 tree 与 `6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52` 相同。这只确认当时合入的源码，不证明行为正确或产物已部署。后续路径变化可从本地已有 Git 对象追溯：

```sh
git log --follow --format='%H %cs %s' -- packages/api/src/messages/history.ts
git log --follow --format='%H %cs %s' -- client/src/data-provider/Messages/window.ts
```

## 3. 维护边界

- 窗口只控制浏览器显示读取，不删除消息、不缩短模型上下文，也不改变 MCP 消息分析协议。显示用正文引用不能写回持久消息。
- 页大小限制消息条数，不是字节预算。普通旧页最多读页大小加一行；`since` 则重验证已加载范围，不受单页条数上限限制，也不应自动补读更早的历史。
- 共享消息缓存仍拥有显示和流式消息。分页边界与打开后的正文使用独立查询键；不能建立第二套消息所有者，也不能把已读取的正文写回显示缓存。
- 每页和 message-scoped 正文读取都要验证会话访问权，并限定用户与租户。查询可以与访问验证并行，但验证通过前不能返回数据。游标只标记位置，不授予访问权。
- 完整导出、分享快照、显式消息目标和缺失父消息有各自的数据需求。不能把当前显示窗口当作完整会话；具体行为仍以 [history.md](history.md) 为准。

配置诊断还要区分登录前后：[config 路由](../api/server/routes/config.js) 的匿名 `/api/config` 只返回登录前白名单字段，不暴露 `historyWindowSize`。核验有效配置应检查配置解析或合法登录后的响应，不能仅凭匿名响应缺字段判定分页失效。

## 4. 实现职责与冲突点

路径用于定位，职责用于判断 upstream 是否等价。文件移动后，应先找等价实现，而不是机械保留旧路径。

| 入口                                                                                                                                                                                                                                                                                 | 维护职责                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [共享 history 类型](../packages/data-provider/src/history.ts)、[配置 schema](../packages/data-provider/src/config.ts)、[YAML 示例](../librechat.example.yaml)                                                                                                                        | `HistoryCursor`、`HistoryPage`、`HistoryOptions`、`AttachmentBodyRef` 及 `DEFAULT_HISTORY_WINDOW_SIZE` / `MAX_HISTORY_PAGE_SIZE`。保留配置默认、范围和关闭方式。                                                                    |
| [数据服务](../packages/data-provider/src/data-service.ts)、[端点](../packages/data-provider/src/api-endpoints.ts)、[查询键](../packages/data-provider/src/keys.ts)                                                                                                                   | `getConversationHistory`、`getAttachmentBody`、参数编码、正文 revision 缓存键和旧服务端数组响应兼容。共享类型还须经包出口可用。                                                                                                     |
| [数据库显示 reader](../packages/data-schemas/src/methods/history.ts)、[消息索引](../packages/data-schemas/src/schema/message.ts)                                                                                                                                                     | `createHistoryMethods` 在 driver 返回前排除 `attachments.text` / `files.text`。按 `createdAt` 与 `_id` 稳定排序，游标使用 `createdAt` / `position`，复用会话、用户、时间和 `_id` 索引。区分普通分页与 `since` 重验证。              |
| [HTTP handler](../packages/api/src/messages/history.ts)、[legacy 路由](../api/server/routes/messages.js)                                                                                                                                                                             | `createHistoryHandler`、`withAttachmentRefs`、`createAttachmentBodyHandler` 负责参数、访问边界与正文引用。分页走会话消息端点的 `history=recent` query；不能新增会遮蔽字面 message ID 的 `/history` 路径。legacy JS 只保留相关接线。 |
| [History 路由层](../client/src/routes/History.tsx)、[Root](../client/src/routes/Root.tsx)、[窗口 context](../client/src/Providers/HistoryWindowContext.ts)、[既有偏好](../client/src/store/autoScroll.ts)                                                                            | 在外围 observer 挂载前注入偏好、配置和显式目标策略。不能只改 Chat 内部 hook；也不能强制开启默认关闭的偏好或改掉已存偏好的 key。                                                                                                     |
| [共享消息查询](../client/src/data-provider/Messages/queries.ts)、[窗口读取](../client/src/data-provider/Messages/window.ts)、[保留期](../client/src/data-provider/Messages/retention.ts)                                                                                             | `readDisplayMessages` 重验证已加载范围；`prependHistory` 去重且保留较新的 live 对象。释放会话历史时清理窗口状态和未被观察的正文缓存。                                                                                               |
| [分页与锚点](../client/src/hooks/Messages/useHistoryPaging.ts)、[分支行](../client/src/hooks/Messages/useThreadRows.ts)、[消息视图](../client/src/components/Chat/Messages/MessagesView.tsx)                                                                                         | 向上触发、失败重试、可见锚点及消息树中段的分支选择。替换消息树或引入虚拟化时，不能只检查是否出现旧消息。                                                                                                                            |
| [按需正文](../client/src/components/Chat/Messages/Content/Parts/LazyAttachment.tsx)、[工具附件](../client/src/components/Chat/Messages/Content/Parts/Attachment.tsx)、[legacy log](../client/src/components/Chat/Messages/Content/Parts/LogContent.tsx)                              | 两种 renderer 都要支持按需卡片。优先走已有鉴权文件预览入口，历史内嵌快照走 message-scoped reader。保留缓存、失败重试、待生成轮询和完整复制/下载。                                                                                   |
| [SSE 恢复](../client/src/hooks/SSE/useResumableSSE.ts)、[滚动](../client/src/hooks/Messages/useMessageScrolling.ts)                                                                                                                                                                  | 恢复继续使用共享显示 reader，不自动补全文。历史替换缩短滚动范围时，浏览器 clamp 到新底部不应丢失已有跟随；真实向上动作仍须解除跟随。                                                                                                |
| [编辑父消息](../client/src/components/Chat/Messages/Content/parent.tsx)、[regenerate](../client/src/hooks/Chat/useChatFunctions.ts)、[导出](../client/src/hooks/Conversations/useExportConversation.ts)、[分享](../client/src/components/Conversations/ConvoOptions/ShareButton.tsx) | 显式操作按需读取缺失父消息、完整显示树或完整正文。分享还要保留所选分支目标，不能因缓存不完整而误判空会话或丢弃目标。                                                                                                                |

### 同批数据库兼容修复

`24b194b8f` 修改的是既有 [messageReads.ts](../packages/data-schemas/src/methods/messageReads.ts)，不是浏览器分页协议。它用条件对象、`$replaceRoot` 与 `$mergeObjects` 代替 `$$REMOVE`，避免触发现有 DocumentDB 静态 guard。该职责属于 [MCP 有界消息读取补丁](mcp-message-reads-patch.md)，可以单独保留或由等价 upstream 实现替换。

[messageReads.spec.ts](../packages/data-schemas/src/methods/messageReads.spec.ts) 使用真实 Mongo fixture，检查缺失与 `null`、`false`、`0`、空对象的区别、Unicode 截窗，以及私有、兄弟和子孙正文的排除。[documentdb.spec.ts](../packages/data-schemas/src/methods/documentdb.spec.ts) 是静态兼容 guard。两者都不能代替这次投影改写在 live DocumentDB 引擎上的验证；本文不声称已完成该验证，也不靠修改 guard 或跳过用例满足兼容要求。

## 5. 回归入口与证据边界

下表说明现有测试负责什么，**不是本次运行通过记录**。以后修改实现时，从所属 workspace 选择受影响的 focused Jest 测试；类型与性能检查按 [AGENTS.md](../AGENTS.md) 执行。仅维护本指南不要求启动应用或重跑业务测试。

| 回归入口                                                                                                                                                                                                                                                                 | 检查重点                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [共享契约](../packages/data-provider/src/history.spec.ts)、[数据库 history](../packages/data-schemas/src/methods/history.spec.ts)                                                                                                                                        | 配置默认与范围、参数编码、旧服务端兼容、同时间戳分页、数据库正文投影、已加载范围重验证、用户与精确租户范围。                                                                                  |
| [API history](../packages/api/src/messages/history.spec.ts)、[真实路由 validation](../api/server/routes/__tests__/messages-get-real-validation.spec.js)                                                                                                                  | 非法请求、授权未定时不返回、读取失败与安全错误、旧客户端数组响应、字面 `history` message ID 和私有 child 读取限制。                                                                           |
| [消息查询](../client/src/data-provider/Messages/__tests__/queries.test.ts)、[窗口](../client/src/data-provider/Messages/__tests__/window.test.ts)、[保留期](../client/src/data-provider/Messages/__tests__/retention.spec.ts)                                            | 外围 observer 的首请求、已加载范围、并发 live 写入、去重、关闭偏好和缓存释放。                                                                                                                |
| [分页锚点](../client/src/hooks/Messages/__tests__/useHistoryPaging.spec.tsx)、[分支行](../client/src/hooks/Messages/__tests__/useThreadRows.spec.tsx)                                                                                                                    | 不后台预取、旧页失败可重试、请求期间读者移动后仍保留锚点，以及父消息补入后的所选分支。                                                                                                        |
| [LazyAttachment](../client/src/components/Chat/Messages/Content/Parts/__tests__/LazyAttachment.test.tsx)、[LogContent](../client/src/components/Chat/Messages/Content/Parts/__tests__/LogContent.test.tsx)                                                               | 挂载不读正文、打开后加载、缓存重开、失败重试、鉴权文件预览和 legacy renderer。                                                                                                                |
| [滚动单测](../client/src/hooks/Messages/__tests__/useMessageScrolling.spec.tsx)、[运行中滚动浏览器场景](../e2e/specs/mock/running-autoscroll.spec.ts)                                                                                                                    | 历史缩短后的跟随、真实向上动作解除跟随，以及开启/关闭偏好时的导航和恢复。                                                                                                                     |
| [regenerate](../client/src/hooks/Chat/__tests__/useChatFunctions.regenerate.spec.tsx)、[export](../client/src/hooks/Conversations/__tests__/useExportConversation.spec.tsx)、[share](../client/src/components/Conversations/ConvoOptions/__tests__/ShareButton.test.tsx) | 缺失父消息按需读取；导出读取 canonical 数据、截图先加载完整显示历史；分享所选目标与初始无缓存处理。分享组件测试不单独证明服务端快照完整性。                                                   |
| [合成长历史浏览器场景](../e2e/lighthouse/history.spec.ts)、[Lighthouse 指南](../e2e/lighthouse/README.md)                                                                                                                                                                | 有界首读、无后台正文读取、显式预览、完整复制/下载、缓存重开、旧页锚点、旧客户端全文和关闭偏好。场景把解码 JSON 字节等写入测试结果目录的 `payload.json`，性能门禁入口为 `npm run lighthouse`。 |

2026-10-19 的实现提交、2026-10-23 的源码静态核对和以后实际运行的回归结果是不同证据。旧 PR 的 CI 计数、payload 或 Lighthouse 数值不作为当前验收结果。合成 fixture 和测试断言说明验证方法，不证明本轮、线上或未来 upstream 已通过；解码 JSON 字节也不是压缩传输大小或用户等待时间。

[2026-10-07 fork audit](fork-audit.md) 保留其日期和当时结论，不覆盖这里的后续补丁。今后重跑应记录日期、准确 HEAD、命令、退出码及通过/失败/未测范围，不把本地结果替代 CI、发布产物或部署验收。

## 6. upstream 替换判据

1. 记录新 upstream base、fork HEAD 和第 2 节三个提交的对应关系。先读语义差异与测试断言；干净合并不证明行为保留。
2. 对照 [history.md](history.md) 和第 3 节边界，确认数据库前置投影、偏好驱动的首请求、稳定页边界、每次鉴权及混合版本兼容。只有分页组件、虚拟列表或同名配置，不足以替代本补丁。
3. 沿第 4 节映射启动与配置链、全部消息 observer、共享缓存、附件 renderer、SSE 和显式消费者。避免留下两套消息所有者，或由某个消费者重新触发后台全文/正文读取。
4. 分别判断数据库兼容修复和滚动修复是否已被接管。用对应回归证明等价后，才移除重复实现；不能删除 guard、放宽预算或削弱断言来获得通过。
5. 按改动覆盖偏好开/关、配置 0/自定义值、空历史、同时间戳、失败重试、分支、活动流/重连、显式目标/父消息、完整导出与分享快照、新旧客户端。配置响应须区分登录前后；分享快照须检查服务端数据来源，不能只看组件用例。
6. 记录适配日期、新 HEAD、保留或替代的职责和实际验证边界，并更新路径。只有等价行为与相关回归得到证明，才标为 upstream 已接管；部分等价时只移除已覆盖部分，不预先宣称整项补丁可删除。
