# 原始提取范围与完整性

本文保存首次提取的历史证据，使用旧基线 `f4154b649efa37e1345ccc517a4d8d1ed2178c82`，完整 fork 源为 `38c026db83d0ca12a067083b5c1551c1bca2754b`，补充文档源为 `2e79586e547131de06494bed2f3274f4745ca435`。原应用净差异涉及 366 个路径，文本统计为 72021 insertions、3197 deletions；统计只描述提取输入。

当前执行基线已更新为 `e6567c7a681ce67869dce31486a21d3a25d6931b`。当前清单为 24 份活动载荷及 vendor-chunks、index-retry 两个上游替代条目，见 [README](../README.md) 和[状态映射](status.md)。下面的原始文件数、blob、tree 和 NOT RUN 记录均属于旧基线提取，不用作新基线的运行验收。

首次提取按最终源码 hunks 归责，构造有序中间 tree，再生成标准 Git U3/binary diff。共享文件保留各组 hunks，不用整文件覆盖上游；完整选择恢复源文件原始字节。历史提交用于追溯，不作为可直接重放的队列。首次清单包含 25 份真实载荷，另有已同源的无载荷 index-retry 条目；当前顺序、路径、状态及依赖以 [manifest.json](../manifest.json) 为准。

## 全部排除项

以下 21 项只排除其 fork 相对基线的差异：基线已有路径保持基线版本，基线不存在的路径不添加。前 18 项是历史 SDK 归档，当前依赖只消费 4.2.2-ricky.1；原文件仍保存在固定源提交的 Git 历史中。

| 路径 | 原因 |
| --- | --- |
| `vendor/agents-4.0.4-ricky.2.patch` | 历史 SDK 归档。 |
| `vendor/agents-4.0.4-ricky.3.patch` | 历史 SDK 归档。 |
| `vendor/agents-4.0.4-ricky.4.patch` | 历史 SDK 归档。 |
| `vendor/agents-4.0.4-ricky.5.patch` | 历史 SDK 归档。 |
| `vendor/agents-4.1.1-ricky.1.patch` | 历史 SDK 归档。 |
| `vendor/agents-4.1.1-ricky.2.patch` | 历史 SDK 归档。 |
| `vendor/agents-4.2.1-ricky.1.patch` | 历史 SDK 归档。 |
| `vendor/agents-4.2.1-ricky.2.patch` | 历史 SDK 归档。 |
| `vendor/agents-4.2.1-ricky.2.source.json` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.0.4-ricky.1.tgz` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.0.4-ricky.2.tgz` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.0.4-ricky.3.tgz` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.0.4-ricky.4.tgz` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.0.4-ricky.5.tgz` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.1.1-ricky.1.tgz` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.1.1-ricky.2.tgz` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.2.1-ricky.1.tgz` | 历史 SDK 归档。 |
| `vendor/librechat-agents-4.2.1-ricky.2.tgz` | 历史 SDK 归档。 |
| `.github/workflows/a11y.yml` | 不重放删除可访问性检查的差异，保留基线工作流。 |
| `docs/fork-audit.md` | 历史审计不装入生成应用；有效状态和来源转入本仓 status.md 与各组 README。 |
| `docs/README.md` | 旧索引不装入生成应用；补丁仓 README 提供维护入口，能力指南随载荷。 |

## 四份文档覆盖

以下文件吸收独立文档源的有效内容，再作维护链接调整。表中 blob 是调整后完整内容的 Git 对象；其他保留路径与完整 fork 源一致。

| 应用路径 | 责任组 | 最终 blob |
| --- | --- | --- |
| `docs/history-window-patch.md` | history-window | `95be6cfe8008dbbecdff8db3fdb34a38f87e0cb8` |
| `docs/mcp-message-reads-patch.md` | bounded-reads | `0b5f657fc7cfb4f05f9019dd55b0aa3bf17833e2` |
| `docs/task-callbacks.md` | task-callbacks | `2083adbccf278873a4a37d7c59e8bd27e8e7d519` |
| `vendor/README.md` | sdk | `f2ca690703333cab2ff6be8063c0e40c8e454125` |

调整规则：当前状态链接转向补丁仓 `patches/docs/status.md`；历史审计链接固定到已发布应用源的 evidence-key，避免依赖未推送的独立文档提交；history-window 的旧文档索引链接转向补丁仓 README；vendor 指南为历史归档段落增加说明，指向固定应用源，明确归档不随当前应用安装或重放。没有继承旧 merge-sync 推荐，原文档工作树不参与运行或维护依赖。

## 树比较方法

预期树从完整 fork 源独立构造：对上述 21 项恢复基线状态，再替换四份文档 blob。提取器比较全部路径、文件模式和 blob，断言没有未分配差异或额外差异；预期完整应用 tree 为：

```text
bd7963d6c15f234810e9fbf441a1341b2fafcf8a
```

完整选择应在干净固定基线应用 checkout 执行 `tools/patchset.py apply`，再用该 checkout 的 `git write-tree` 比较。相同 tree 证明最终内容、模式与提取范围一致，不证明运行行为。只比较路径数量、构建结果或测试标题数量均不足以替代这个比较。

本阶段实际完成一次固定基线离线 checkout 重放，25 份载荷应用成功。随后只修正 history-window 指南的一处历史审计链接，并同步到该 checkout；最终 tree 如上，与完整清单在独立 index 的结果及从源树构造的预期一致。366 个输入差异路径中排除 21 项，保留 345 项，其中四份文档按上述规则覆盖，其余 341 项与 fork 源字节和模式一致。完整应用树没有额外差异。

各组依赖闭包已用独立临时 index 核对可应用；新增模块的相对导入与 `~/` 导入扫描未发现缺失模块。四处相邻独立增量采用单侧稳定上下文，位置和预检方式见 [maintenance.md](maintenance.md)，不把非依赖组混入上下文。

## 原始提取阶段验证范围

维护工具单元测试使用微型 Git 仓和受控 runner 进程，覆盖依赖选择、完整预检、脏目标/错误基线/重复应用保护、清单路径、替代证据、计划入口、目标 cwd、失败传播、Jest/Playwright discovery 与空跑/跳过拒绝。受控进程测试 runner 逻辑，不代表应用测试已通过。

原始提取阶段的维护工具 13 项单元测试通过。该阶段应用重放只执行合同 `--tier all --plan`：142 个合同项去重为 70 个检查命令，入口校验全部通过并输出 NOT RUN；没有执行应用 Jest、类型检查、构建、浏览器或 Lighthouse。旧基线实际源差异的 `git diff --check <固定基线>` 通过，独立于嵌套 patch 文件的字节保留。当前验证范围见 [README](../README.md)，执行方法见 [维护说明](maintenance.md)。

补丁仓只保留许可证、来源、维护说明、清单、载荷和维护工具；应用发布 workflow 仅存在于载荷数据。`.work/` 内的临时提取脚本、index、checkout 和日志不提交，也不是交付依赖。应用源码继续保存在固定源 Git 历史及下一阶段生成的应用 checkout 中。
