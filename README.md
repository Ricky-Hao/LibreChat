# LibreChat fork 补丁集

`patches` 分支保存可选择、可重放的 fork 差异。应用源码在独立应用 checkout 中生成；本分支不承载活动 GitHub Actions。

固定应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。完整 fork 源：`38c026db83d0ca12a067083b5c1551c1bca2754b`。
共有 26 个状态条目、25 份标准 Git diff：`keep` 9、`feature` 4、`awaiting-upstream` 4、`local` 8、`upstream` 1。

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

四项 `awaiting-upstream` 在此固定基线上仍需应用。上游 dev 已合入不代表所选应用基线已有替代；只有核实目标包含等价行为后才修改状态。

## 下一阶段验证

`--plan` 只检查合同入口路径并输出 `NOT RUN`，不运行 discovery 或测试。在应用 checkout 按其贡献指引准备依赖与构建后，在补丁仓串行执行：

```sh
python3 tools/patchset.py test --target /path/to/application --tier focused
python3 tools/patchset.py test --target /path/to/application --tier types
python3 tools/patchset.py test --target /path/to/application --tier browser
python3 tools/patchset.py test --target /path/to/application --tier project
```

runner 在应用 checkout 执行：Jest 精确 discovery、逐文件结果与非空断言，Playwright 精确文件 discovery、禁用重试与非空结果；跳过或失败均非完整通过。`project` 保留应用静态检查及适用 Lighthouse 门禁。共享命令去重，重型检查串行。

本阶段只验证维护工具、差异结构、提取完整性和一次离线重放。没有运行应用 Jest、类型检查、浏览器、构建或 Lighthouse；机械重放不代表业务行为通过。

维护工具自测：

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -v
```

应用的合并、发布和部署属于后续阶段，沿既有 `rickyhao/dev` → GHCR 流程执行。新基线同步及 default branch/发布入口切换也属于后续任务；本分支不改变 default branch、应用主分支或发布入口。
