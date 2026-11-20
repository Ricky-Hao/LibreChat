# MCP 服务端发起 ping 的响应

状态 `keep`。应用基线 `d4e85d2205c78413ee27d631d7e3b7313556f21d`。

保留合法空成功响应，避免 transport wrapper 在时间窗口内压掉 server-initiated ping；client liveness probe 保持原合同。

依赖：无；以固定基线已有模块为前提。

## 载荷与来源

[changes.patch](changes.patch) 是代码、测试及必要文档的标准 Git diff。路径范围以根 manifest.json 的 paths 为准。
最终源码来自 [`38c026db83d0ca12a067083b5c1551c1bca2754b`](https://github.com/Ricky-Hao/LibreChat/commit/38c026db83d0ca12a067083b5c1551c1bca2754b)；按净差异归组，包含截至该源的后续修正，不直接重放历史提交队列。
主要行为与后续修正追溯：

- [192e0955e7eca68a60617922dc7080b4ede92c58](https://github.com/Ricky-Hao/LibreChat/commit/192e0955e7eca68a60617922dc7080b4ede92c58)

固定基线包含上游 [#18020](https://github.com/LibreChat-AI/LibreChat/pull/18020) 的替代提交 `413456941ccc079f5b132b245fbfa7a7bf756a60`。`connection.ts` 移除了相同的 `lastPingTime` 与空结果过滤逻辑。`MCPConnectionPing.test.ts` 通过真实 MCP SDK 覆盖连续 ping、普通调用以及客户端探测失败和降级。载荷保留 Streamable HTTP 同 session 的心跳、时钟偏移、重连和非 ping 空结果合同。

## 维护与验证

先读当前调用方和 [行为映射](../../docs/status.md)，再按 [维护步骤](../../docs/maintenance.md) 适配。改动跨组共享文件时，保留其他组的 hunks 和依赖，不用整文件覆盖上游。
仅在所选基线包含等价替代并补齐证据后改为 `upstream`/`replaced`；部分替代只移除被覆盖的责任。

[tests.json](tests.json) 是非空可执行合同，在生成的应用 checkout 运行。入口预检：

```sh
python3 tools/patchset.py test --target /path/to/application --only mcp-ping --tier all --plan
```

去掉 `--plan` 才执行检查；按 `focused`、`types`、`browser`、`project` 分阶段串行运行。没有该 tier 时工具报错，不记成功。共享测试文件可能同时覆盖其他组，失败需按当前选择排查。
2026-11-11 在上一轮基线通过本组 focused 与 API 类型检查，包含真实 MCP SDK 的 ping 回归。[历史验收](../../README.md#历史验收2026-11-11)
