# 补丁仓维护规则

本分支管理补丁数据与维护工具。应用工程规则保存在 `contributor-guidance` 载荷，并在生成的应用 checkout 生效。

- 先读 README、manifest、相关组 README 和 `docs/maintenance.md`。只改当前责任，不扩大应用能力。
- `manifest.json` 是唯一执行顺序。按独立能力或修复分组，显式记录依赖；共享文件按 hunks 保留各组责任，不用整文件覆盖上游。
- 每组保留理由、状态、基线、来源、后续修正、替代边界和非空测试合同。历史提交只作来源，不能当作可直接重放的提交队列。
- 已合入上游 dev 不足以停用补丁。核实所选目标的等价实现和必要调用方后，才记录 replacement commit/evidence 并改状态；部分替代只移除覆盖的责任。
- SDK 使用 `Ricky-Hao/agents` 的既有源码与版本。携带当前消费产物、元数据、源码 patch 和构建接线；SDK 修复在其所属仓库维护。
- 维护工具只用 Python 标准库与 Git。失败清楚停止，保护工作树；不自动换基线、跳冲突、重置、stash 或强推。
- 测试在应用 checkout 执行，确认实际 discovery、非空执行和失败传播。入口计划、树比较、构建和历史计数不能替代业务测试。
- 修改维护工具后运行 `python3 -m unittest discover -s tools -p 'test_*.py' -v`。文档及清单改动检查内容、引用、结构和 `git diff --check`；应用测试按具体任务授权执行。
- `.work/` 是忽略的本地工作区，不作为交付依赖。不得把临时 checkout、凭据或日志加入提交。
- 本分支不放活动发布/部署 workflow。应用流程仍为设计、开发、测试、合并到 `rickyhao/dev`、发布、部署；本说明不增加后续动作授权。
- commit、push 及外部动作遵守当前任务授权。保护其他工作树及未知修改，不清理无关任务或会话。
