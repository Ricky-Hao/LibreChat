# LibreChat fork 补丁集

`patches` 是默认分支和维护源码主分支，保存可选择、可重放的 fork 差异。应用源码在独立应用 checkout 中生成；活动 CI 从 manifest 固定基线重放后构建 GHCR 镜像。

今后同步上游默认按[上游同步默认流程](docs/maintenance.md#上游同步默认流程)执行：固定官方 upstream main 完整 SHA → 有序补丁重放与验证 → 合入 `patches` → CI 镜像 → 按 digest 部署。每轮按用户请求完成相应阶段，发布和部署按当次授权执行。

固定应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`（upstream main）。原始完整 fork 源：`38c026db83d0ca12a067083b5c1551c1bca2754b`。
共有 26 个状态条目、24 份标准 Git diff：`keep` 9、`feature` 4、`awaiting-upstream` 3、`local` 8、`upstream` 2。
本轮 12 组可直接应用，12 组完成冲突或接口适配；2 组使用固定基线的等价实现，其中 vendor-chunks 本轮退役，index-retry 延续原有替代。

[manifest.json](manifest.json) 是唯一有序清单，负责状态、依赖、载荷路径和测试合同。每个 `patches/<id>/` 包含行为说明、来源、维护步骤及非空 `tests.json`；活动条目另有 `changes.patch`。

- [26 组行为映射与替代边界](docs/status.md)
- [应用、测试及维护方法](docs/maintenance.md)
- [提取范围、全部排除项与树比较](docs/extraction.md)
- [来源与许可证](SOURCES.md)

维护入口：[新增补丁](docs/maintenance.md#新增补丁)、[更新补丁或基线](docs/maintenance.md#修改或更新基线)、[应用补丁](docs/maintenance.md#选择与失败处理)、[淘汰补丁](docs/maintenance.md#淘汰补丁)。各流程共用[测试合同](docs/maintenance.md#测试合同)。

## 在应用 checkout 重放

维护工具只需要 Python 3.9+ 和 Git。下面命令在补丁仓根目录执行。`/path/to/application` 必须是单独的、干净的 Git checkout，HEAD 精确等于固定基线。

```sh
python3 tools/patchset.py list
python3 tools/patchset.py check --target /path/to/application
python3 tools/patchset.py apply --target /path/to/application
python3 tools/patchset.py test --target /path/to/application --tier all --plan
```

`check` 在私有 index 中预检整列。`apply` 预检成功后一次应用并暂存，不提交、不切分支。遇到冲突、目标已有修改、基线不符或重复应用即停止。

`--only history-window` 会按清单顺序纳入传递依赖；`--status keep feature` 按状态选择并纳入依赖。先用相同参数执行 `list` 查看实际选择。更换选择必须从干净固定基线重新生成，不在已应用的 checkout 追加。

三项 `awaiting-upstream` 在此固定基线上仍需应用。`vendor-chunks` 和 `index-retry` 已由固定基线中的实现替代。上游 dev 已合入不代表所选应用基线已有替代；只有核实目标包含等价行为后才修改状态。

## 验证

`--plan` 只检查合同入口路径并输出 `NOT RUN`，不运行 discovery 或测试。在应用 checkout 按其贡献指引准备依赖与构建后，在补丁仓串行执行：

```sh
python3 tools/patchset.py test --target /path/to/application --tier focused
python3 tools/patchset.py test --target /path/to/application --tier types
python3 tools/patchset.py test --target /path/to/application --tier browser
python3 tools/patchset.py test --target /path/to/application --tier project
```

runner 在应用 checkout 执行：Jest 精确 discovery、逐文件结果与非空断言，Playwright 精确文件 discovery、禁用重试与非空结果；跳过或失败均非完整通过。`project` 保留应用静态检查及适用 Lighthouse 门禁。共享命令去重，重型检查串行。

2026-11-11，在此固定基线上完成完整重放、26 组传递依赖闭包预检和 71 项去重合同验收：54 项 focused、6 项 types、9 项 browser 和 2 项 project 全部通过。最终有效结果去重后为 106 个 Jest suites、6074 个 tests，以及 80 个 Playwright tests，无失败、跳过、todo 或 Playwright 自动重试。intent-labels 的完整浏览器文件复用 test-adaptations 中更新后执行的结果。

业务验收版本的正式重放与[应用提交 `4ab9f9c44fdeab80d4f99dddf9e7ac7944f53f79`](https://github.com/Ricky-Hao/LibreChat/commit/4ab9f9c44fdeab80d4f99dddf9e7ac7944f53f79) 的 tree 均为 `dcc8f4edc32c510e7eea8e9b514ef0117c02c90c`。

CI 采用阶段仅同步应用 `AGENTS.md` 的维护与发布入口；当前[应用提交 `c81e3483feffc4e6ae50298dcf081139c1b3a98f`](https://github.com/Ricky-Hao/LibreChat/commit/c81e3483feffc4e6ae50298dcf081139c1b3a98f) 与正式重放的 tree 为 `c00edf8153e549ffc044609af4a21c9eb409dc5f`。业务实现未变，复用上述完整验收与生产构建证据。新增 CI 的 actionlint、24 种发布条件、权限、精确 checkout、完整祖先历史及构建 context 检查通过；本地实际执行验证与发布两个 job 的重放脚本，均得到该 tree，脏目标失败能立即停止。13 项维护工具自测及贡献文档合同通过。应用文档提交经原 hooks 正常提交、推送，pre-push 以已完整验收的 `4ab9f9c` 为本次文档增量基线；没有重跑完整业务或慢速门禁。

随后已完成默认分支切换、真实 CI 镜像发布及首次 digest 部署。补丁版本 `08f1af9cfd6179adfdad0934ec73306dc07cc399` 的[自动构建 #30](https://github.com/Ricky-Hao/LibreChat/actions/runs/43026513891) 与[部署所用构建 #31](https://github.com/Ricky-Hao/LibreChat/actions/runs/43028307670) 均成功，后者的镜像已通过 rollout、内外健康检查和构建版本核验；完整 SHA、digest 与验收边界见[采用及首次部署记录](docs/status.md#ci-采用与首次部署2026-11-11)。CI 的业务合同仍仅执行 `--plan`，不计为重新运行全套业务测试。

首次浏览器执行发现历史窗口、移动端编辑器入口和耗时文案断言未适配当前上游；修正夹具和定位后，相关失败及连带跳过用例已实际补跑通过。提交 lint 另发现计时器测试字面文本与导出夹具嵌套三元表达式，修正后定向执行的 33 个计时器测试和 3 个导出浏览器测试通过。上述重复执行不另加到去重计数。

首次应用 push 因本地 Husky 入口缺失而未执行 pre-push；恢复入口后，完整门禁发现消费方夹具有重复的 `useHistory`。去重后，`packages/chat` 源码与消费方测试的类型检查及 4 个 suites、35 个 Jest tests 通过，修正已同步到 history-window 载荷。

依锁安装、真实 SDK 来源/导出 smoke、生产前端构建和 6 个项目构建任务通过。Lighthouse 复用生产构建，两个场景通过；三次有效审计中位数为 LCP 3572.769 ms、CLS 0.0129309074、TBT 296.17 ms，原预算分别为 4500 ms、0.1、500 ms。首次审计出现一次 NO_NAVSTART，由现有 runner 重试后完成。

已提交应用相对固定基线的普通 static-checks 通过；最终提交另通过原 pre-push 的 `--full --skip config-tests` 检查，包含慢速类型检查与未使用 i18n keys 检查。传输中断后，普通重推复用原门禁按相同 tree、base 和参数缓存的成功结果，退出 0。原 pre-push 显式跳过 Config migration tests；Unused npm packages 因未安装 depcheck 跳过，ESLint config validation 因本轮差异未涉及而不执行。这些项目不计为已运行通过。

原始业务执行证据留在本地 `.work/main-e6567c7/`，不作为补丁重放依赖。该阶段使用隔离 loopback 服务、memory Mongo 与 Chromium；后续 CI 镜像构建及首次部署已有上述独立证据。全新 Devcontainer/Envbuilder 环境、可选 Compose、真实 Redis/provider 与 Safari/Firefox 未验收；本阶段也未实测登录后的模型、工具、子 agent、PTC callback、Langfuse 或长期稳定性。

维护工具自测：

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
```

## CI 与镜像来源

[Rickyhao Dev Docker Image](.github/workflows/rickyhao-dev-image.yml) 监听 `patches` 的 push、目标为 `patches` 的 PR，并保留手动入口。只读验证 job 运行 Python 维护工具自测、校验 manifest、获取固定上游及完整祖先历史，使用正式工具 check/apply 全部载荷并记录生成 tree；合同 `--plan` 只校验入口，明确标记业务测试 `NOT RUN`。

发布 job 依赖验证成功，仅在 `Ricky-Hao/LibreChat` 的 `refs/heads/patches` push/手动事件运行。它从相同补丁 SHA 和固定 base 再生成应用、核对 tree，然后从该目录的 `Dockerfile.multi`、`api-build` target 构建 `linux/amd64` 镜像。PR 不登录 registry 或推镜像。

镜像继续发布到 `ghcr.io/ricky-hao/librechat:rickyhao-dev`，该标签保留为兼容入口；追溯与部署使用完整补丁 SHA 标签 `sha-<patchset SHA>` 和对应 digest。OCI revision、`io.librechat.patchset.revision` 和运行时 `BUILD_COMMIT` 表示补丁集版本，`BUILD_BRANCH` 为 `patches`；`io.librechat.upstream.base` 与 `io.librechat.generated.tree` 分别记录上游基线和生成源码 tree，不把补丁 SHA 当作应用 checkout 的 HEAD。部署按[默认流程](docs/maintenance.md#上游同步默认流程)在当次授权范围执行。

生成应用中的旧 `rickyhao/dev` workflow 仍由 [fork-image](patches/fork-image/README.md) 载荷保留，其静态合同只检查兼容数据；活动入口以本补丁仓根 workflow 为准。维护、合并和发布采用 `patches` → manifest 重放 → GHCR 流程，不要求将新应用合回旧 fork。
