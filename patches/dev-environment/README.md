# Coder 开发环境与测试准备

状态：`local`。应用基线：`f4154b649efa37e1345ccc517a4d8d1ed2178c82`。

保留无需 Compose 的 Envbuilder build 配置、实际用户所有权、固定 runtime、native/browser 库、locked setup 与 Lighthouse wrapper，以及 frontend review 的必要构建准备。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [d373ea1ffaf8cde3eeae9f9ae05c8497d7d7ca87](https://github.com/Ricky-Hao/LibreChat/commit/d373ea1ffaf8cde3eeae9f9ae05c8497d7d7ca87)
- [a8fad7e113c8617da003f84926deaf1090041395](https://github.com/Ricky-Hao/LibreChat/commit/a8fad7e113c8617da003f84926deaf1090041395)
- [4a7330a3f97ff05c13399c1e766ebd3ad85bf082](https://github.com/Ricky-Hao/LibreChat/commit/4a7330a3f97ff05c13399c1e766ebd3ad85bf082)
- [60663053cd91cee73fb70cf3566e74f360e055b9](https://github.com/Ricky-Hao/LibreChat/commit/60663053cd91cee73fb70cf3566e74f360e055b9)

保留固定基线 a11y workflow；不携带删除可访问性检查的历史差异。setup 合同不代表 fresh Docker/Envbuilder image 或 Compose 启动已通过。

## 维护与验证

先读当前调用方和 [26 组映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only dev-environment --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
本阶段未运行本组应用测试；机械重放和入口存在不代表业务通过。
