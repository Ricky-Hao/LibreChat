# Fork 镜像发布入口

状态：`local`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

载荷保存现有 rickyhao/dev → GHCR 入口：准确 SHA checkout、fork/ref guard、amd64、branch/SHA tags、OCI labels 与 branch cache。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [aac3b604eb0a57a3f047dc9e02075b410493dcda](https://github.com/Ricky-Hao/LibreChat/commit/aac3b604eb0a57a3f047dc9e02075b410493dcda)
- [d4aa7f06f7e1e44eddf99245e38e4af4c20aba17](https://github.com/Ricky-Hao/LibreChat/commit/d4aa7f06f7e1e44eddf99245e38e4af4c20aba17)

本组 workflow 保留为旧 `rickyhao/dev` 的兼容载荷，现有合同继续精确检查该来源；不将应用侧合同改成补丁仓 CI 的合同。当前活动入口位于补丁仓根的 [同名 workflow](../../.github/workflows/rickyhao-dev-image.yml)，从 `patches` 的 manifest 生成应用后构建镜像，继续使用 `rickyhao-dev` 标签。静态合同不发布镜像，也不证明 registry/Actions 可用；部署使用已发布产物。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only fork-image --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11：workflow 静态合同通过，核实仅 `rickyhao/dev` 的 push 可进入发布任务。未运行镜像发布或部署。项目门禁汇总见[根 README](../../README.md#验证)。
