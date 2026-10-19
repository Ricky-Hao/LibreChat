# 会话历史窗口与附件按需读取：补丁维护与 upstream 合并指南

本文记录 2026-10-19 合入 fork 的浏览器显示历史优化，说明改动原因、实现职责和以后合并 upstream 时必须保留的行为。使用与配置见 [Conversation display history](history.md)。本指南以仓库源码、实际提交和可重跑的测试为依据，不依赖聊天记录或临时任务目录。

## 1. 来源与改动原因

原链路在打开长会话时读取整个显示历史，并随消息传回附件正文。工具调用预览已经能够缩短工具参数和输出，但不会自动去掉历史附件正文，也不会限制首屏消息条数。结果是用户只想查看最近回复，浏览器仍须接收、解析和处理整段历史。

一次旧版只读诊断样本包含 541 条消息和 405 个附件，解码后的消息响应约 19.35 MB，其中附件正文约 10.8 MB。这是当时一个会话的诊断结果，不是通用阈值或当前生产基准；本仓库不保存该会话的身份、正文、认证信息或原始响应。

因此，本次把优化放在显示读取链路的两处：

1. 打开会话时，根据已有用户偏好先读取最近一页，用户向上浏览时再取旧页。
2. 在数据库投影中排除显示用附件正文，只在显式打开预览后鉴权读取，并复用已打开正文的缓存。

只减少 DOM 节点不能消除数据库读取、网络传输和 JSON 解析成本；取得全文后再裁剪也已经支付了这些成本。本补丁保留现有工具调用预览策略，并单独处理消息窗口和附件正文。

### 实际提交

- fork 仓库：`Ricky-Hao/LibreChat`；目标分支：`rickyhao/dev`。
- 补丁前基线：`6a5abda24648efac4f71910ab355b2f5b419034f`。
- 合并记录：[PR #6](https://github.com/Ricky-Hao/LibreChat/pull/6)。

| 实现提交                                                                                                                             | 职责                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`4d4bb575b86014fb8c6a363fa31064356fd4c8d6`](https://github.com/Ricky-Hao/LibreChat/commit/4d4bb575b86014fb8c6a363fa31064356fd4c8d6) | 历史窗口、数据库轻量投影、附件按需读取、客户端缓存和配套测试。                 |
| [`24b194b8f03fdd5ad895ef5845f517a3c4a0277b`](https://github.com/Ricky-Hao/LibreChat/commit/24b194b8f03fdd5ad895ef5845f517a3c4a0277b) | 去除既有有界消息 reader 中的 DocumentDB 不兼容移除表达式，并增加投影边界回归。 |
| [`6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52`](https://github.com/Ricky-Hao/LibreChat/commit/6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52) | 保持历史替换后的底部跟随语义，并适配受影响的测试接线。                         |

合并提交为 [`993d27ddb53eb50831e3b3b583e610a7d418eee4`](https://github.com/Ricky-Hao/LibreChat/commit/993d27ddb53eb50831e3b3b583e610a7d418eee4)，其 tree 与最终验收的功能 HEAD `6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52` 相同。合并后的路径可能继续演进，应结合文件历史定位当前实现。发布、部署和运行健康须分别核验，不由本文的提交记录推定。

可从已具有这些对象的本地 checkout 追溯：

```sh
git show --stat 4d4bb575b86014fb8c6a363fa31064356fd4c8d6
git show --stat 24b194b8f03fdd5ad895ef5845f517a3c4a0277b
git show --stat 6e69eaacd0eb0631c6eca1ad292254e3d0c1cb52
git diff --stat 6a5abda24648efac4f71910ab355b2f5b419034f 993d27ddb53eb50831e3b3b583e610a7d418eee4
git log --follow -- packages/api/src/messages/history.ts
git log --follow -- client/src/data-provider/Messages/window.ts
```

## 2. 必须保持的外部行为

| 场景                                                         | 行为与边界                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 已有 **Auto-Scroll to latest message on chat open** 偏好开启 | 默认首读最近 24 条消息；是消息条数，不是对话轮数。接近已加载历史顶部或点击 **Load older messages** 才读旧页。                      |
| 上述偏好关闭                                                 | 保持从头查看完整显示历史。该偏好原默认关闭，本补丁没有强制为所有用户开启。                                                         |
| `interface.historyWindowSize`                                | 默认 24，允许 1–100 调整页大小，0 关闭分页；见 `librechat.example.yaml`。                                                          |
| 普通历史附件                                                 | 初始仅显示元数据；打开预览才读取正文。重开复用缓存，加载、失败重试、完整复制和下载路径保留。待生成的预览仅在打开后按既有策略轮询。 |
| 向上加载与流式回复同时发生                                   | 保留可见消息及其屏幕偏移、所选分支和较新的流式消息对象，不重复消息，也不以旧页覆盖新内容。                                         |
| 显式消息目标、缺失父消息                                     | 显式目标可加载完整显示树；编辑或 regenerate 按需读取缺失父消息。不能把窗口边界当作整段历史不存在。                                 |
| 导出、分享与模型上下文                                       | 模型上下文、存储的消息和附件正文、完整导出及分享快照继续使用完整数据；截图导出先显式加载完整显示历史。                             |
| 混合客户端与服务端版本                                       | 未传显示参数的旧客户端继续得到含正文的完整数组；新客户端接受旧服务端的完整数组响应。                                               |

窗口控制浏览器显示读取，不是删除旧消息、缩短模型上下文、修改 token 预算或修改 MCP 消息分析 API。附件引用只属于显示投影，不能回写为消息的持久正文。

每个分页和正文请求都必须重新验证会话访问权，并显式限定用户和租户。游标仅标记位置，不授予访问权。匿名 `/api/config` 按既有登录前白名单返回字段，不保证出现 `historyWindowSize`；核验有效默认值需要检查运行配置解析或合法登录后的配置响应，不能以匿名响应缺字段判定功能失效。

## 3. 实现职责与冲突定位

下表中的路径和符号是移植入口；未来 upstream 重命名或移动文件时，按职责找等价实现。

| 层次与关键文件                                                                                                                                                                                                                                                            | 实现与合并时需要检查的内容                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [共享契约](../packages/data-provider/src/history.ts)、[配置](../packages/data-provider/src/config.ts)、[数据服务](../packages/data-provider/src/data-service.ts)、[端点](../packages/data-provider/src/api-endpoints.ts)、[查询键](../packages/data-provider/src/keys.ts) | `HistoryCursor`、`HistoryPage`、`HistoryOptions`、`AttachmentBodyRef`，默认 24/上限 100、参数编码、包导出与缓存键。类型、构建出口和运行时配置须一起贯通。                                                                              |
| [数据库显示 reader](../packages/data-schemas/src/methods/history.ts)                                                                                                                                                                                                      | 在 driver 返回前排除附件与上传文件的正文，复用 `(conversationId, user, createdAt, _id)` 索引；同时间戳用存储位置稳定排序，公开游标使用 `createdAt` 与 `position`。普通旧页最多取页大小加一行检测后续页，已加载范围的重验证另有职责。   |
| [HTTP handler](../packages/api/src/messages/history.ts)、[legacy 路由接线](../api/server/routes/messages.js)                                                                                                                                                              | `createHistoryHandler`、`withAttachmentRefs`、`createAttachmentBodyHandler` 负责参数、访问验证和正文引用。分页使用会话消息端点的 `history=recent` 等 query，避免新增 `/history` 路径与原 message ID 路由冲突；legacy JS 保持接线职责。 |
| [路由层 History](../client/src/routes/History.tsx)、[窗口策略 context](../client/src/Providers/HistoryWindowContext.ts)、[Root](../client/src/routes/Root.tsx)                                                                                                            | 在外围消息 observer 挂载前确定本次导航的读取策略；只改 Chat 内部 hook 会留下首请求先读全文的漏洞。                                                                                                                                     |
| [共享消息查询](../client/src/data-provider/Messages/queries.ts)、[窗口边界](../client/src/data-provider/Messages/window.ts)、[保留期](../client/src/data-provider/Messages/retention.ts)                                                                                  | 原共享消息缓存继续拥有显示及流式消息；单独记录窗口边界，重验证已加载范围，旧页 prepend 保留 live 对象。窗口状态和打开后的附件正文随会话保留策略释放。                                                                                  |
| [分页与锚点](../client/src/hooks/Messages/useHistoryPaging.ts)、[分支行](../client/src/hooks/Messages/useThreadRows.ts)、[消息视图](../client/src/components/Chat/Messages/MessagesView.tsx)                                                                              | 处理向上触发、重试、可见锚点和从树中间开始时的分支展示。上游引入虚拟化或替换消息树时须重测这些语义。                                                                                                                                   |
| [附件按需组件](../client/src/components/Chat/Messages/Content/Parts/LazyAttachment.tsx)、[工具附件](../client/src/components/Chat/Messages/Content/Parts/Attachment.tsx)、[legacy log](../client/src/components/Chat/Messages/Content/Parts/LogContent.tsx)               | 复用已有鉴权文件预览入口，历史内嵌快照使用 message-scoped 正文读取；保留完整 copy/download、缓存、错误和待生成状态。检查两种 renderer，不能只接通一种卡片。                                                                            |
| [流式恢复](../client/src/hooks/SSE/useResumableSSE.ts)、[滚动](../client/src/hooks/Messages/useMessageScrolling.ts)                                                                                                                                                       | 恢复与历史重验证不能自动补读所有旧页。历史替换可能缩短滚动范围，浏览器 clamp 到新底部时保留已有跟随权；真实向上滚轮、按键、触摸和离底滚动仍应解除跟随。                                                                                |
| [编辑与父消息](../client/src/hooks/Chat/useChatFunctions.ts)、[完整导出](../client/src/hooks/Conversations/useExportConversation.ts)、[分享](../client/src/components/Conversations/ConvoOptions/ShareButton.tsx)                                                         | 展示窗口不等于完整历史；显式操作根据需要读取父消息、完整消息树或正文。合并时检查这些消费者，不能将显示投影直接用于完整导出。                                                                                                           |

### 同批兼容修复的独立职责

`24b194b8f` 修改的是已有 [messageReads.ts](../packages/data-schemas/src/methods/messageReads.ts) 中四处 `$$REMOVE` 表达式。原基线已存在这些表达式，并会触发现有 DocumentDB 静态兼容 guard；本次以条件对象构造、`$replaceRoot` 和 `$mergeObjects` 保持公开投影语义，并新增 [messageReads.spec.ts](../packages/data-schemas/src/methods/messageReads.spec.ts) 的真实 Mongo 边界测试。

这属于既有 [MCP 有界消息读取补丁](mcp-message-reads-patch.md) 的兼容性修复，不是浏览器分页协议，也不是关闭 DocumentDB 检查。移植时可以单独保留或由经过验证的等价上游实现替换；必须继续区分字段缺失与 `null`、`false`、`0`、空对象，保持 Unicode 截窗与私有/兄弟/子孙内容排除。真实 Mongo 和静态 guard 已验证，未对 live DocumentDB 引擎实测。

## 4. 回归证据与以后重跑的入口

原合并前最终功能 HEAD 的远端检查为 **43/43 success**。下面列出仓库内可追溯的测试职责；这是该次源码的历史证据，不代表未来 upstream 或当前生产业务已经验收。不同轮次的测试集合有重叠，不能相加为独立测试总数。

| 测试入口                                                                                                                                                                                                                                                                 | 必须检查的行为                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [共享 history 契约测试](../packages/data-provider/src/history.spec.ts)                                                                                                                                                                                                   | 分页和正文引用契约、客户端参数编码与兼容行为。                                                                                                         |
| [数据库 history 测试](../packages/data-schemas/src/methods/history.spec.ts)                                                                                                                                                                                              | 轻量投影、稳定页边界、访问范围和正文按需读取。                                                                                                         |
| [API history 测试](../packages/api/src/messages/history.spec.ts)、[真实路由 validation 测试](../api/server/routes/__tests__/messages-get-real-validation.spec.js)                                                                                                        | 参数校验、用户/租户限制、访问失败、旧客户端合同和实际接线。受影响的消息修改、删除、保留期、子会话路由测试也要随接线变动检查。                          |
| [消息查询](../client/src/data-provider/Messages/__tests__/queries.test.ts)、[窗口](../client/src/data-provider/Messages/__tests__/window.test.ts)                                                                                                                        | 首请求与重验证范围、live 对象保留、去重、旧服务端响应和缓存边界。                                                                                      |
| [分页锚点](../client/src/hooks/Messages/__tests__/useHistoryPaging.spec.tsx)、[分支行](../client/src/hooks/Messages/__tests__/useThreadRows.spec.tsx)、[消息视图](../client/src/components/Chat/Messages/__tests__/MessagesView.spec.tsx)                                | 向上翻页不跳读、所选分支与消息树中段展示。                                                                                                             |
| [LazyAttachment](../client/src/components/Chat/Messages/Content/Parts/__tests__/LazyAttachment.test.tsx)、[LogContent](../client/src/components/Chat/Messages/Content/Parts/__tests__/LogContent.test.tsx)                                                               | 打开后读取、缓存与失败重试、两种 renderer。                                                                                                            |
| [滚动单测](../client/src/hooks/Messages/__tests__/useMessageScrolling.spec.tsx)、[运行中自动滚动浏览器测试](../e2e/specs/mock/running-autoscroll.spec.ts)                                                                                                                | 历史替换缩短范围后继续跟随、真实向上动作解除跟随；保留原浏览器阈值与开启/关闭两种偏好。                                                                |
| [regenerate](../client/src/hooks/Chat/__tests__/useChatFunctions.regenerate.spec.tsx)、[export](../client/src/hooks/Conversations/__tests__/useExportConversation.spec.tsx)、[share](../client/src/components/Conversations/ConvoOptions/__tests__/ShareButton.test.tsx) | 缺失父消息按需取得，完整导出与分享不被显示窗口截断。                                                                                                   |
| [大型历史浏览器场景](../e2e/lighthouse/history.spec.ts)、[Lighthouse 说明](../e2e/lighthouse/README.md)                                                                                                                                                                  | 首次 recent 24、无后台附件正文或自动全文补读、显式预览、完整复制/下载、缓存重开、旧页锚点、旧客户端全文和偏好关闭。性能门禁使用 `npm run lighthouse`。 |
| [messageReads 边界回归](../packages/data-schemas/src/methods/messageReads.spec.ts) 与仓库原 DocumentDB guard                                                                                                                                                             | 兼容表达式不改变公开投影、字段存在性、Unicode 和内容隔离；不能通过修改 guard 或跳过用例获得通过。                                                      |

大型历史场景使用独立合成数据：541 条消息、405 个附件。原本地验收中的解码 JSON 对比为：

| 合成场景                     | 消息条数 | 解码 JSON 字节 |
| ---------------------------- | -------: | -------------: |
| 旧客户端完整响应（含正文）   |      541 |     14,693,819 |
| 首屏最近一页（正文按需读取） |       24 |         22,972 |

场景还验证了首次 history 请求 1 次、正文请求 0 次，打开预览后正文请求 1 次，重开缓存不增加请求；旧页无重复 ID，锚点偏移约 0.5 px。测试会在结果目录写 `payload.json`。这些数字不是生产 Brotli 传输大小、用户交互耗时或普遍的性能提升承诺；变更 fixture 或实现后应重测，不复制旧数字当新结果。

在最终功能源码上，完整 Lighthouse lane 通过，三次报告的中位数为 LCP 4128.882 ms、CLS 0.017901170121559694、TBT 350.18199999999933 ms，原预算分别为 4500 ms、0.1、500 ms。它们仍是当时本地合成环境的历史结果。未来修改消息加载、配置、恢复或滚动生产路径时，应按项目规则运行相关单测、受影响包的 typecheck、真实浏览器场景和 Lighthouse，记录精确新 HEAD 与原失败，不放宽阈值。

## 5. 合并 upstream 的操作清单

1. 记录新的 upstream base、fork HEAD，以及上面三个提交在新历史中的对应关系。先读其语义差异和测试断言，再处理文本冲突；干净合并本身不能证明行为保留。
2. 对照第 2 节逐项检查新上游是否已提供等价行为，尤其是数据库前置投影、偏好驱动的首请求、稳定游标、无后台全文/正文预取、鉴权和混合版本兼容。仅有分页组件、虚拟列表或同名配置不足以认定补丁已被替代。
3. 沿第 3 节检查实际启动链、配置传播、共享缓存及全部消费者。上游替换 query、路由、消息树、附件 renderer、SSE 或导出接口时，按新职责适配，避免保留两套消息所有者或两套互相触发的全文读取。
4. 分别处理 `24b194b8f` 的数据库兼容语义和 `6e69eaacd` 的滚动语义。若 upstream 已修复，使用原回归测试证明等价后合并或移除重复实现；不因原问题来自继承代码而省略检查。
5. 按第 4 节覆盖开启/关闭偏好、配置 0/自定义值、空历史、同时间戳、分页失败重试、分支、活动流/重连、显式目标/父消息、完整导出及旧客户端。对新配置响应的检查须区分登录前后。
6. 在新 HEAD 记录通过/失败/未测项和可重跑入口，更新本指南中的路径、提交对应关系与证据边界。只有等价行为和回归均得到证明，才将本地职责标为已由 upstream 接管。

未来适配记录可追加到本节之后，写明实际日期、upstream base、fork HEAD、替代或保留的职责和验收结果；本指南没有预先宣称任何未来 upstream 已具备等价实现。
