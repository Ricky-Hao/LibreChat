# 侧栏延迟 focus

状态 `upstream`。应用基线 `d4e85d2205c78413ee27d631d7e3b7313556f21d`。

侧栏延迟打开期间保留用户主动选择的 focus，避免 fallback 抢走焦点。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

此组由固定应用基线提供实现和测试。旧载荷的 fork 来源为 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)。主要行为来源如下。

- [4d4a4dc93c35cd899a6ba9bee82a9758272748fd](https://github.com/Ricky-Hao/LibreChat/commit/4d4a4dc93c35cd899a6ba9bee82a9758272748fd)

固定基线包含上游 [#18001](https://github.com/LibreChat-AI/LibreChat/pull/18001) 的替代提交 `fa9031ae74f32e21c42d26c082a6b704b2e9bfd6`。`OpenSidebar.tsx` 在桌面延迟打开时仅在 opener 或 body 仍持有焦点时移交焦点。移动 drawer 在 commit 时继续移交。组件测试覆盖 opener/body、主动焦点和 slide/snap，浏览器测试包含后续修正 `c380c9e5d53eecf1569da2e151a9188e11a628a6`。

## 维护与验证

先读当前调用方和 [行为映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only sidebar-focus --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11 在上一轮基线通过 OpenSidebar focused 与 client 类型检查。[历史验收](../../README.md#历史验收2026-11-11)
