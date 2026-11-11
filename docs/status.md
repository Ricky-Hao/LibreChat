# 行为映射与替代边界

本表吸收独立文档提交 `2e79586e547131de06494bed2f3274f4745ca435` 的 26 行状态记录，并保留完整 fork 源 `38c026db83d0ca12a067083b5c1551c1bca2754b` 的来源信息。执行基线固定为 upstream main `e6567c7a681ce67869dce31486a21d3a25d6931b`；原记录对 upstream dev `0eadbc45b1304b5986ce1c324bfda1421faaabfe` 的比较只作为历史来源。

`manifest.json` 是唯一执行顺序。本表按原行为记录顺序展示映射，目录内 README 记录完整来源 SHA、后续修正、依赖及维护合同，`tests.json` 指向生成应用中的实际检查入口。

| 原行为行 | 当前责任组 | 状态 | 保留或替代边界 |
| --- | --- | --- | --- |
| 1. Foreground/online stream recovery | [stream-recovery](../patches/stream-recovery/README.md) | keep | frozen-OPEN、attachment/epoch fence、缺失与读取失败、online rearm；上游局部 reconnect 不等价。 |
| 2. Terminal recovery budget | [stream-recovery](../patches/stream-recovery/README.md) | keep | 默认、自定义、零预算及已有 stream 的晚到策略；与恢复共用状态机，不退回固定 MAX_RETRIES。 |
| 3. Edited response prefixes and fold decisions | [retained-prefix](../patches/retained-prefix/README.md) | keep | 服务端 capture/admission、provenance、恰好一次投影、fold 三态、multipart/index/phase 及全部终态调用方。 |
| 4. Running subagent snapshots | [subagent-snapshots](../patches/subagent-snapshots/README.md) | keep | 稀疏 parent-message 快照、归属、memory/Redis 与客户端重建；不同于上游持久 task journal。 |
| 5. Auto-scroll on revisit and history replacement | [autoscroll](../patches/autoscroll/README.md) | keep | 显式发送与恢复 identity、导航 readiness、手动 detach 和历史替换后的 bottom-follow。 |
| 6. Summary/reasoning normalization and usable checkpoints | [summary-checkpoints](../patches/summary-checkpoints/README.md) | keep | 多块/空 reasoning、失败/空白/legacy stub 拒绝和保留不确定性的摘要指引。 |
| 7. SDK 4.2.2 summary coverage consumers | [summary-checkpoints](../patches/summary-checkpoints/README.md) | keep | coverage.retainedFromMessageId 的消息/actor 存储、冷 parent-chain 读取、可信 warm overlay 和旧摘要 fallback；包含 PR #14 后续修正。 |
| 8. Skill source and assistant phases | [skill-provenance](../patches/skill-provenance/README.md) | keep | source identity/version、历史版本不确定性和 commentary/final 经转换、聚合及 reload 保真。 |
| 9. Schema-aware PTC intent | [ptc-invocation](../patches/ptc-invocation/README.md) | keep | 按实际 callee schema 去除 UI intent，保留业务 intent、校验与 rich result；基线已有的 helper 不重复携带。 |
| 10. PTC protocol error status | [ptc-errors](../patches/ptc-errors/README.md) | keep | 已知 ToolMessage/MCP 协议失败在 SDK 输出与 host trace 保持失败；任意业务 status/error 不算协议失败。 |
| 11. Direct external task callbacks | [task-callbacks](../patches/task-callbacks/README.md) | feature | 注册、owner/tenant/anchor、持久终态接收、幂等、过期、child-context 拒绝、清理及原会话续接。 |
| 12. PTC callback bridge | [task-callbacks](../patches/task-callbacks/README.md) | feature | 与 direct 共用注册与持久化；保留 opt-in/tool 绑定、inner-call identity、可信 host context 和 trace 脱敏，marker 不授予权限。 |
| 13. Bounded MCP message reads | [bounded-reads](../patches/bounded-reads/README.md) | feature | DB projection、wire budget、逐页授权、UTF-8 continuation、revision writes 和 DocumentDB 表达式；普通 pagination/preview 不等价。 |
| 14. Display history, lazy attachments and inactive-cache retention | [history-window](../patches/history-window/README.md) | feature | observer admission、paging/anchor、DB body 排除、鉴权懒读取、缓存所有权及 export/share/edit 完整调用；非硬 DOM/heap 上限。 |
| 15. Native mobile overlay dismissal | [native-overlays](../patches/native-overlays/README.md) | feature | CloseWatcher/Navigation API、层栈、受控/非受控 dialog、Forward 和匹配 FINAL sync；不恢复 synthetic history，不承诺不支持原生 API 浏览器的通用 Back 拦截。 |
| 16. Vendor chunk classification | [vendor-chunks](../patches/vendor-chunks/README.md) | upstream | 固定基线已含 #17921，采用上游第一层 node_modules 嵌套归组及 Windows 路径规范化，移除本地末段裁剪载荷；保留真实 config probe 合同。 |
| 17. MCP server-initiated ping responses | [mcp-ping](../patches/mcp-ping/README.md) | awaiting-upstream | 固定基线保留合法空成功响应；目标确含 #18020 等价实现与回归覆盖后移除本地变体。 |
| 18. Unknown-provider MCP display images | [mcp-images](../patches/mcp-images/README.md) | awaiting-upstream | 目标确含 #18000 后采用 display-only imageAttachments；未知 provider 不声明 vision 支持，fallback 模型文本 base64 膨胀仍未解决。 |
| 19. Delayed sidebar focus | [sidebar-focus](../patches/sidebar-focus/README.md) | awaiting-upstream | 目标确含 #18001 后采用 opener/body guard，保留 mobile drawer commit handoff；不替代 overlay 能力。 |
| 20. Shared index retry helper | [index-retry](../patches/index-retry/README.md) | upstream | 基线已含 createIndexesWithRetry 与 retry.spec.ts；无载荷，callback 索引初始化调用方仍在 task-callbacks。 |
| 21. Intent label limits and mobile wrapping | [intent-labels](../patches/intent-labels/README.md) | local | 标签长度和窄屏呈现可单独放弃；保留上游 timing/error UI，与 invocation 正确性分开。 |
| 22. Subagent initialization diagnostics | [subagent-diagnostics](../patches/subagent-diagnostics/README.md) | local | correlation/stage 细节可简化，授权、模型、配置校验及安全失败分类仍须保留。 |
| 23. Internal files versus delivered artifacts | [file-guidance](../patches/file-guidance/README.md) | local | workspace/scratch/delivery 模型指引；不构成 collector 或秘密隔离保证，不单独作为保留完整 fork SDK 的理由。 |
| 24. Visible conversation loading priority | [loading-priority](../patches/loading-priority/README.md) | local | 提前可见会话查询，沿用 enabled 条件、不增加查询；独立于历史窗口，性能需实际 Lighthouse。 |
| 25. Devcontainer, fork image CI, build/test adaptations | [dev-environment](../patches/dev-environment/README.md)、[fork-image](../patches/fork-image/README.md)、[test-adaptations](../patches/test-adaptations/README.md) | local | 分别维护 Coder/locked setup、现有 rickyhao/dev 镜像入口和当前有效 fixture；保留基线 a11y workflow，不重放过期 fixture。 |
| 26. Vendored SDK, lock/build wiring and prior artifacts | [sdk](../patches/sdk/README.md) | keep | 只携带当前消费的 4.2.2-ricky.1、源码 patch、元数据、锁文件、主机消费方和构建接线；历史归档不重放。 |

另有 [contributor-guidance](../patches/contributor-guidance/README.md) 文档载荷（local），保存应用 AGENTS 和 PR template 的净差异。根 AGENTS 负责补丁仓自身维护。合并三对行为、拆出环境/镜像/测试责任并保留贡献指南后，清单共 26 条目、24 份载荷：keep 9、feature 4、awaiting-upstream 3、local 8、upstream 2。

## 替代证据

以下四项的来源和固定基线实现已核对。`vendor-chunks` 已完全替代；其余三项继续应用：

| 责任组 | 上游状态与来源 | 适用条件 |
| --- | --- | --- |
| vendor-chunks | [#17921](https://github.com/LibreChat-AI/LibreChat/pull/17921)，merge `fc3b86acbc0a5290154b25f7a0091641667cd14b`；#15907 被替代，#17567 已完成 | 替代提交是固定基线祖先；`client/vite.config.ts` 按第一层 node_modules 分类，嵌套包跟随所属外层包，规范化 Windows 分隔符。对应 Playwright 合同执行两个真实配置 probe。 |
| mcp-ping | [#18020](https://github.com/LibreChat-AI/LibreChat/pull/18020) 已合入 dev；PR head `7b59bc972982e6424cb48918c5c1d7de42391717`；#17568 已完成 | PR head 不是 merge SHA；更新基线时取得目标实际包含的替代提交与实现证据。 |
| mcp-images | [#18000](https://github.com/LibreChat-AI/LibreChat/pull/18000) 已合入 dev；PR head `b8f7c5d2b97557ed85a71027c933f61c33bd806a`；#17569 已完成 | PR head 不是 merge SHA；核对附件持久化、display-only 路径与剩余 base64 边界。 |
| sidebar-focus | [#18001](https://github.com/LibreChat-AI/LibreChat/pull/18001) 已合入 dev；PR head `e86cc7c687905de4e277e66a6f93a036e16617dc`；#17570 已完成 | PR head 不是 merge SHA；核对 deliberate focus 与 mobile drawer handoff。 |

index-retry 的 replacement commit 为 `e2b2839375d5e8052dec4785bf3117ce27aa67dc`，已在固定基线祖先链，helper 与基线一致。当前跳过 vendor-chunks 和 index-retry 两项载荷。将来完全替代须记录完整 replacement.commit 和行为证据；部分替代只移除对应 hunks，不连带删除剩余能力、持久数据合同或调用方。

## 延续的贡献状态与验证边界

文档来源记录：[#15906](https://github.com/LibreChat-AI/LibreChat/pull/15906) 为 draft，与未合入的 [#15966](https://github.com/LibreChat-AI/LibreChat/pull/15966) 重叠；保留仍需的预算/恢复更新，覆盖核实后再退役重复贡献。[#15955](https://github.com/LibreChat-AI/LibreChat/pull/15955) 未合入且已含原生 overlay 重写。已关闭未合入的 [#15864](https://github.com/LibreChat-AI/LibreChat/pull/15864) 动态密码消息不在本分支载荷；[#15851](https://github.com/LibreChat-AI/LibreChat/pull/15851) 已合入，无独立重放。这里只吸收既有状态记录，不执行外部评论或贡献整理。

原始历史审计及其测试计数仍可从 [固定应用源](https://github.com/Ricky-Hao/LibreChat/blob/38c026db83d0ca12a067083b5c1551c1bca2754b/docs/fork-audit.md) 读取，不转为本阶段 pass。2026-11-11 的固定基线验收完成 71 项去重合同：54 项 focused、6 项 types、9 项 browser 和 2 项 project 全部通过。去重后 106 个 Jest suites、6074 个 tests 及 80 个 Playwright tests 通过；生产构建、固定基线 static-checks 和两个 Lighthouse 场景通过，原有失败及修正后补跑见[根 README](../README.md#验证)。loading-priority 的调用顺序本身仍不能证明性能改善，本轮 Lighthouse 只证明当前实验场景满足原预算。

最终[应用提交 `4ab9f9c44fdeab80d4f99dddf9e7ac7944f53f79`](https://github.com/Ricky-Hao/LibreChat/commit/4ab9f9c44fdeab80d4f99dddf9e7ac7944f53f79) 与正式重放共用 tree `dcc8f4edc32c510e7eea8e9b514ef0117c02c90c`。原 pre-push 完整检查通过，普通 push 已成功；原门禁跳过的配置迁移测试、缺少 depcheck 的依赖检查及未涉及的 ESLint 配置检查见根 README，不计入已运行通过项。

fresh Docker/Envbuilder、可选 Compose、镜像发布、部署、真实 Redis/provider 与 Safari/Firefox 均没有新增验收证据。

当前采用固定基线加有序补丁的维护方法，见 [maintenance.md](maintenance.md)。独立文档里的旧 merge-sync 推荐不作为此补丁仓的默认流程；应用主分支迁移、合并、发布和部署仍需各自方案与授权。
