# LibreChat fork 补丁集

`patches` 分支保存可选择、可重放的 fork 差异。应用源码在独立应用 checkout 中生成；本分支不承载活动 GitHub Actions。

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

正式重放与[生成应用提交 `4ab9f9c44fdeab80d4f99dddf9e7ac7944f53f79`](https://github.com/Ricky-Hao/LibreChat/commit/4ab9f9c44fdeab80d4f99dddf9e7ac7944f53f79) 的 tree 均为 `dcc8f4edc32c510e7eea8e9b514ef0117c02c90c`。

首次浏览器执行发现历史窗口、移动端编辑器入口和耗时文案断言未适配当前上游；修正夹具和定位后，相关失败及连带跳过用例已实际补跑通过。提交 lint 另发现计时器测试字面文本与导出夹具嵌套三元表达式，修正后定向执行的 33 个计时器测试和 3 个导出浏览器测试通过。上述重复执行不另加到去重计数。

首次应用 push 因本地 Husky 入口缺失而未执行 pre-push；恢复入口后，完整门禁发现消费方夹具有重复的 `useHistory`。去重后，`packages/chat` 源码与消费方测试的类型检查及 4 个 suites、35 个 Jest tests 通过，修正已同步到 history-window 载荷。

依锁安装、真实 SDK 来源/导出 smoke、生产前端构建和 6 个项目构建任务通过。Lighthouse 复用生产构建，两个场景通过；三次有效审计中位数为 LCP 3572.769 ms、CLS 0.0129309074、TBT 296.17 ms，原预算分别为 4500 ms、0.1、500 ms。首次审计出现一次 NO_NAVSTART，由现有 runner 重试后完成。

已提交应用相对固定基线的普通 static-checks 通过；最终提交另通过原 pre-push 的 `--full --skip config-tests` 检查，包含慢速类型检查与未使用 i18n keys 检查。传输中断后，普通重推复用原门禁按相同 tree、base 和参数缓存的成功结果，退出 0。原 pre-push 显式跳过 Config migration tests；Unused npm packages 因未安装 depcheck 跳过，ESLint config validation 因本轮差异未涉及而不执行。这些项目不计为已运行通过。

原始执行证据留在本地 `.work/main-e6567c7/`，不作为补丁重放依赖。验收使用隔离 loopback 服务、memory Mongo 与 Chromium；fresh Docker/Envbuilder、可选 Compose、真实 Redis/provider、Safari/Firefox、镜像发布和部署未验收。

维护工具自测：

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
```

应用的合并、发布和部署属于后续阶段，沿既有 `rickyhao/dev` → GHCR 流程执行。本轮只交付新基线补丁适配分支和生成的应用分支；本分支不改变 default branch、应用主分支或发布入口。
