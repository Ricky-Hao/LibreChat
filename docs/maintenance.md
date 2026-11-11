# 应用与维护

四个流程入口：[新增补丁](#新增补丁)、[更新补丁或基线](#修改或更新基线)、[应用补丁](#选择与失败处理)、[淘汰补丁](#淘汰补丁)。各流程的验证共用[测试合同](#测试合同)。

## 新增补丁

1. 固定 manifest 的完整 `base` SHA、补丁仓版本及新组插入位置，先确认已有组是否可承担该责任。明确所需前序组和依赖闭包，在独立应用 checkout 按[应用流程](#选择与失败处理)从干净固定基线生成该状态，用 `git write-tree` 记录准确的 `before` tree。
2. 在该应用 checkout 完成代码及必要调用方、测试和文档，暂存本组全部变更（包括新增文件），再用 `git write-tree` 记录 `after` tree。共享文件只携带本组 hunks，其他组的责任和显式依赖继续保留。
3. 用[更新流程](#修改或更新基线)第 4 步的标准 diff 命令，从上述准确的 `before`/`after` 生成 `patches/<id>/changes.patch`；路径包括本组所有新增、修改及删除文件。
4. 在唯一的 [manifest.json](../manifest.json) 中把新条目放到其依赖之后，填写唯一 `id`、实际活动 `status`、`depends_on`、`patch`、完整 `paths` 和 `tests`。组 README 写明行为预期、理由、状态、基线、依赖、来源与后续修正、替代边界；非空 `tests.json` 按[测试合同](#测试合同)指向实际检查入口。
5. 按应用流程检查完整选择及各组依赖闭包，从干净固定基线生成应用并审查全清单测试入口，再执行相应业务检查及项目适用检查。核对差异、文档链接和 `git diff --check` 后，在补丁仓正常 commit、push；入口计划或树比较不代替业务检查。

最小 metadata 可参照 manifest 中 `sidebar-focus` 条目（无依赖、两个路径）及其 [README](../patches/sidebar-focus/README.md)、[tests.json](../patches/sidebar-focus/tests.json)。沿用字段结构，状态、依赖和检查按新组实际责任填写。

## 选择与失败处理

`manifest.json` 的 `patches` 数组是唯一顺序。`keep`、`feature`、`local`、`awaiting-upstream` 都应用；`upstream`、`replaced` 跳过载荷，但必须有完整 `replacement.commit` 和行为证据，工具核对该提交已在目标 HEAD 的祖先链。

默认选择全部条目。`--only ID...` 自动包含传递依赖；`--status STATUS...` 先按状态选，再包含依赖，因此依赖可能来自其他状态。两种选择参数互斥。先执行相同选择的 `list`。

`check`/`apply` 要求目标是独立 Git checkout 根目录，HEAD 精确等于 manifest 的完整基线 SHA，且暂存区、跟踪文件、非忽略的未跟踪文件均干净。预检在目标 Git 目录的临时 index 逐项应用，检查语法、路径清单及顺序。整列成功后生成普通 U3/binary 合成 diff，`apply` 用一次 `git apply --index` 写入并暂存；不创建逐 patch commits，也不自动提交。

失败会给出条目和 Git 原因。后序预检失败不会留下前序修改。工具不自动下载提交、换基线、采用三方冲突结果或跳过失败项。重新选择需从干净固定基线生成，不支持在已应用或其他脏应用 checkout 上不断追加；保留失败现场和用户工作，由维护者修正载荷或选择，不用 reset/clean 掩盖问题。应用时不要让其他进程同时修改目标。

需要逐组定位时，为每个累积选择另用干净固定基线 checkout，再用 `--only ID...` 生成。例如先选择 `--only sdk`，下一次在另一干净 checkout 选择 `--only sdk summary-checkpoints`；选定条目的传递依赖自动补齐，并按 manifest 顺序整列预检、一次落地。

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

执行 `project` 前，先审查并提交生成应用的改动。`static-checks --against <固定基线>` 从基线到已提交 HEAD 选择文件，不包含未提交的新改动；在刚应用补丁的暂存状态运行不能证明交付差异已受检。应用的 pre-push 还要求工作树干净，并通过 `LIBRECHAT_PRE_PUSH_BASE=<固定基线>` 固定检查范围。

依赖安装后确认应用的 `.husky/_/pre-push` 存在且可执行；缺少时运行应用现有 `npm run prepare` 恢复本地入口。仅配置 `core.hooksPath=.husky/_` 不会生成入口文件。

runner 按顺序执行，对完全相同的共享命令去重。没有所选 tier 时非零退出。Jest 必须精确发现全部合同文件，每个文件有实际断言且通过；pending/todo 非完整通过。Playwright 必须精确发现文件、报告非空成功，错误、跳过、重试或失败均非完整通过。命令异常和缺入口立即非零退出，不继续报告成功。`command` 的证据范围以实际命令为准，例如 workflow 静态断言不证明镜像发布。

共享测试文件可能包含多个能力；单组选择通过入口校验不代表其业务可独立验收。优先用当前选择的完整合同验证，再按失败的调用关系处理真实依赖。不要为了通过合同删除有效断言或把测试永久跳过。重型 Jest、类型检查、构建和浏览器检查串行运行。

维护工具自身只使用 Python 标准库和 Git：

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
git diff --check
```

`*.patch` 保留原始字节，不把嵌套 diff 的上下文空行当作补丁仓空白错误；另在应用 checkout 对实际源差异执行 `git diff --check <固定基线>`，区分继承问题和维护新增问题。

## 修改或更新基线

更新现有补丁沿用[新增流程](#新增补丁)的 before/after、metadata 和验证要求：`before` 不含待更新组的旧载荷，`after` 含其完整新版本；仅修改补丁时保留原 `base`。

1. 固定应用基线、当前应用源和补丁仓版本；更换基线时先固定并评估候选 upstream 完整 SHA。在新应用任务分支/checkout 比较行为，先核调用方、持久数据、配置、权限和错误处理。不要把旧 fork 的 merge 历史当作补丁队列。
2. 对每个条目判断保留、适配、放弃本地偏好或被替代。放弃或替代按[淘汰流程](#淘汰补丁)处理；等价证据须指向所选目标实际包含的提交、实现和相应测试。PR 在 dev 合入、同名文件或机械可应用均不足以证明等价。
3. 部分替代只删去已覆盖的 hunks，保留剩余责任及依赖。完全替代后更新状态和 replacement；不要留下仍会执行的重复载荷。SDK 的更换须同时核主机消费方，不能回退 PR #14 的 coverage 读取/存储合同。
4. 从目标前序状态生成每组 `git diff --binary --full-index --no-ext-diff --no-renames <before> <after> -- <paths>`，包含代码、必要调用方、测试与文档。共享文件只选择本组 hunks，不复制整文件覆盖；更新 manifest 路径和 tests 合同。
5. 更换基线时将 manifest 的 `base` 改为已评估的完整 SHA；检查完整顺序、各组依赖闭包和入口，修复所有冲突。完成实际应用检查与受影响业务测试，再更新各组来源和状态。重放或树比较只证明提取完整性。
6. 在补丁仓正常提交与推送，经适用测试后合入维护主分支 `patches`。活动 CI 按 manifest 生成完整应用并发布现有 GHCR 镜像；不将生成应用合回旧 `rickyhao/dev`，不强推或重置已发布分支。合并、push、发布及部署按当前授权执行。

## 淘汰补丁

### 上游等价替代

按[更新流程](#修改或更新基线)核实所选目标的等价实现及必要调用方，记录完整 `replacement.commit` 和指向实现、测试的 `replacement.evidence`。完全替代时将 `status` 改为 `upstream`/`replaced`、`patch` 设为 `null`、`paths` 设为 `[]`，删除旧载荷；保留组 README 和非空测试合同，合同指向替代实现的实际检查入口。工具在应用时核验替代提交是目标 HEAD 的祖先后才跳过。部分替代按更新流程只移除对应 hunks，保留剩余责任、依赖和活动载荷。

### 主动放弃可选功能

1. 先核使用方、持久数据和其他补丁的依赖。涉及已有数据或用户承诺的功能删除，须在任务授权内单独确定保留、迁移或停止支持方案，再执行相关改动。
2. 适配或移除受影响使用方，调整或删除依赖，重生成受影响载荷的 hunks、`paths` 和测试合同；只删除 `depends_on` 不能解决仍在使用该功能的代码。
3. 从活动 manifest 移除条目，不将主动放弃标成 `upstream`/`replaced`，也不虚构 replacement commit。可删除完整 `patches/<id>/` 目录，由 Git 历史保存；也可只保留不被清单引用的退役 README，写明放弃原因和最后版本。不在 manifest 中的目录不执行。

两种淘汰均须同步状态映射及链接，审查全清单的顺序、依赖、路径和测试入口，尤其是共享入口；按[应用流程](#选择与失败处理)从干净固定基线验证完整选择及受影响组的依赖闭包，并执行[测试合同](#测试合同)中的相关实际回归及适用项目检查。完成差异与文档检查后正常 commit、push。移出清单只改变以后生成的应用，不会删除现有应用 checkout 或已发布分支中的功能；应用采用另按更新流程确定方案。

## CI 与发布

活动入口为补丁仓根的 [`.github/workflows/rickyhao-dev-image.yml`](../.github/workflows/rickyhao-dev-image.yml)。目标为 `patches` 的 PR 只运行维护工具自测、固定基线完整重放和测试合同入口计划；入口计划不执行业务测试，业务改动仍需上述适用合同的真实证据。

本仓库 `patches` 的 push 或手动事件在验证成功后才可进入发布 job。两个 job 都 checkout 精确补丁 SHA；上游 checkout 使用 manifest 完整 SHA 和 `fetch-depth: 0`，确保 replacement 祖先检查有效。发布 job 重新生成并核对已验证 tree，再登录 GHCR，从生成应用目录构建，失败即停止。只有发布 job 拥有 `packages: write`，验证 job 仅有 `contents: read`。

`ghcr.io/ricky-hao/librechat:rickyhao-dev` 保留为现有部署使用的标签，`sha-<完整补丁 SHA>` 用于追溯该补丁版本。镜像 labels 同时记录补丁 revision、manifest base 和生成 tree；运行时 BUILD_COMMIT 指补丁 revision，BUILD_BRANCH 为 `patches`。Actions 依赖沿用现有 major 并固定完整 commit SHA，更新时核对发布说明与安全公告。旧应用中的同名 workflow 为兼容载荷，不是本分支的活动发布入口。

本仓采用固定上游基线加有序补丁的维护方法。发布来源为通过检查并合入 `patches` 的补丁版本；部署对应已发布产物。默认分支设置由仓库负责人处理，代码 push 不等于设置已切换。流程说明不授权额外 tag、Release、dispatch 或部署。
