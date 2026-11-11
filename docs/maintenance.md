# 应用与维护

## 选择与失败处理

`manifest.json` 的 `patches` 数组是唯一顺序。`keep`、`feature`、`local`、`awaiting-upstream` 都应用；`upstream`、`replaced` 跳过载荷，但必须有完整 `replacement.commit` 和行为证据，工具核对该提交已在目标 HEAD 的祖先链。

默认选择全部条目。`--only ID...` 自动包含传递依赖；`--status STATUS...` 先按状态选，再包含依赖，因此依赖可能来自其他状态。两种选择参数互斥。先执行相同选择的 `list`。

`check`/`apply` 要求目标是独立 Git checkout 根目录，HEAD 精确等于 manifest 的完整基线 SHA，且暂存区、跟踪文件、非忽略的未跟踪文件均干净。预检在目标 Git 目录的临时 index 逐项应用，检查语法、路径清单及顺序。整列成功后生成普通 U3/binary 合成 diff，`apply` 用一次 `git apply --index` 写入并暂存；不自动提交。

失败会给出条目和 Git 原因。后序预检失败不会留下前序修改。工具不自动下载提交、换基线、采用三方冲突结果或跳过失败项。重新选择需从干净固定基线生成；保留失败现场和用户工作，由维护者修正载荷或选择，不用 reset/clean 掩盖问题。应用时不要让其他进程同时修改目标。

四处相邻但独立的增量使用单侧稳定上下文，避免把可选组误写成上下文依赖：

| 补丁组 | 文件位置 |
| --- | --- |
| task-callbacks | `packages/api/src/agents/index.ts` 的 barrel |
| stream-recovery | `packages/data-provider/src/config.ts` 的恢复配置 schema |
| history-window | `packages/data-provider/src/config.ts` 的配置导入 |
| history-window | `client/src/locales/en/translation.json` 的相邻文案 |

这些仍是标准 Git diff。私有 index 预检使用 `--unidiff-zero` 接受缺少一侧上下文的 hunk；写入工作树的合成 diff 使用普通上下文。其余上下文、完整路径清单和固定基线共同约束位置。不要用 `git apply --reject` 或盲目忽略上下文绕过失败。

## 测试合同

每组 `tests.json` 含非空 `checks`。每项定义 `name`、`tier`、相对应用根的 `cwd`、非空 `requires` 及 `runner`。`jest`/`playwright` 定义精确 `files`；Playwright 另有 `config`；`command` 定义非空参数数组，直接执行，不经过 shell。

`test --tier all --plan` 校验所选合同结构、工作目录和入口路径，输出 `NOT RUN`，不声称测试已被框架发现。实际执行前，在应用 checkout 按其 README、`.devcontainer/README.md` 及 AGENTS 准备 Node、锁文件依赖和共享包构建；浏览器合同还需 production client 和 mock harness，按 `e2e/playwright.config.mock.ts` 的实际要求准备。

| tier | 检查内容 |
| --- | --- |
| focused | owning workspace 的 Jest，或 SDK、环境、workflow、文档的专用命令 |
| types | 受影响 workspace 的 `tsc --noEmit`；构建不替代类型检查 |
| browser | 实际 Playwright mock specs，单 worker、零重试、禁止 `.only` |
| project | 对固定应用基线的 static-checks，及适用的 `npm run lighthouse` |

runner 按顺序执行，对完全相同的共享命令去重。没有所选 tier 时非零退出。Jest 必须精确发现全部合同文件，每个文件有实际断言且通过；pending/todo 非完整通过。Playwright 必须精确发现文件、报告非空成功，错误、跳过、重试或失败均非完整通过。命令异常和缺入口立即非零退出，不继续报告成功。`command` 的证据范围以实际命令为准，例如 workflow 静态断言不证明镜像发布。

共享测试文件可能包含多个能力；单组选择通过入口校验不代表其业务可独立验收。优先用当前选择的完整合同验证，再按失败的调用关系处理真实依赖。不要为了通过合同删除有效断言或把测试永久跳过。重型 Jest、类型检查、构建和浏览器检查串行运行。

维护工具自身只使用 Python 标准库和 Git：

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
git diff --check
```

`*.patch` 保留原始字节，不把嵌套 diff 的上下文空行当作补丁仓空白错误；另在应用 checkout 对实际源差异执行 `git diff --check <固定基线>`，区分继承问题和维护新增问题。

## 修改或更新基线

1. 固定候选 upstream SHA、当前应用源和补丁仓版本。在新应用任务分支/checkout 比较行为，先核调用方、持久数据、配置、权限和错误处理。不要把旧 fork 的 merge 历史当作补丁队列。
2. 对每个条目判断保留、适配、放弃本地偏好或被替代。等价证据须指向所选目标实际包含的提交、实现和相应测试。PR 在 dev 合入、同名文件或机械可应用均不足以证明等价。
3. 部分替代只删去已覆盖的 hunks，保留剩余责任及依赖。完全替代后更新状态和 replacement；不要留下仍会执行的重复载荷。SDK 的更换须同时核主机消费方，不能回退 PR #14 的 coverage 读取/存储合同。
4. 从目标前序状态生成每组 `git diff --binary --full-index --no-ext-diff --no-renames <before> <after> -- <paths>`，包含代码、必要调用方、测试与文档。共享文件只选择本组 hunks，不复制整文件覆盖；更新 manifest 路径和 tests 合同。
5. 将 manifest 基线改为已评估的完整 SHA，检查完整顺序、各组依赖闭包和入口，修复所有冲突。完成实际应用检查与受影响业务测试，再更新各组来源和状态。重放或树比较只证明提取完整性。
6. 在补丁仓正常提交与推送。应用分支的采用、与现有 `rickyhao/dev` 历史的整合及发布需要各自明确方案；新重放分支合回旧 fork 不会自动删除旧补丁。不强推、重置已发布分支或切换镜像 ref 完成迁移。

本仓采用固定上游基线加有序补丁的维护方法。历史文档中的“从旧 fork 合并上游”不是本补丁仓的默认更新流程。发布仍只能使用通过检查、合并到应用主分支后的提交；部署对应已发布产物。
