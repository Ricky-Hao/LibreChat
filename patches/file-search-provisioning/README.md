# 在实际文件搜索时准备附件

状态：`keep`。应用基线：`e6567c7a681ce67869dce31486a21d3a25d6931b`。

纯代码或 MCP 的 PTC 调用只准备代码环境附件，不再因外层 `run_tools_with_bash`／`run_tools_with_code` 无条件触发向量化。权限筛选后的实际内层 `file_search.invoke` 先沿现有 callback 准备附件，再重新加载搜索工具，读取准备后的文件列表；不扫描程序文本，也不依赖 `tool_manifest` 提前声明搜索。

`RAG_API_URL` 未设置、为空或全空白时，工具定义、加载、文件上下文与附件 callback 均视为搜索不可用。显式执行搜索查询仍返回明确错误。已配置的 RAG 不可达或嵌入失败也保留失败，不伪装成空搜索成功；部分文件查询成功时延续原有部分结果行为。

代码附件 provision、Agent 知识库与用户附件的 scope、队列 claim／commit／release、并发合并、失败重试和取消继续由现有文件模块负责。PTC 编排、callee schema、业务 intent、权限、trace 和任务 callback 保留原合同。

依赖：[task-callbacks](../task-callbacks/README.md)，使用其真实 context-aware PTC bridge；其传递依赖包含 SDK、PTC invocation／error 与摘要合同。共享文件只携带本组 hunks，`ptc-invocation` 继续维护 schema-aware intent。

## 载荷与来源

[changes.patch](changes.patch) 从完整前序补丁 tree `c00edf8153e549ffc044609af4a21c9eb409dc5f` 提取，路径以根 [manifest.json](../../manifest.json) 为准。该前序状态由补丁任务起点 `7dfaad4156d55acc52f7a97343aa13cf24c31bbe` 在固定基线正式重放得到；新修复直接在隔离应用 checkout 开发，没有新增 SDK 版本或改 SDK 产物。

应用修复的本地提交为 `de551a7ba267e8b3774536dc98de85b6f90befcf`。正常提交 hook 后的 tree 与独立固定基线 checkout 正式全量重放均为 `0a137b707f55ec1c0d450d6e8b12fb3a8adebb09`。

来源为 2026-11-11 的附件预处理故障：纯 PTC 在 `RAG_API_URL not defined` 后报 `Failed to provision 2 file(s) for search`。后续修正包括实际 invoke 时准备并重载、host 配置注入、搜索工厂及文件 primer 迁入 `packages/api` TypeScript，以及通过既有 `outboundRequestBudget` 同时保留 HTTP 查询超时和调用方取消。legacy CJS 仅保留依赖与调用接线。

尚无所选基线中的等价替代。仅当目标同时覆盖按实际调用准备、准备后文件重载、无 RAG 的一致行为和错误／取消／scope 合同后，才记录 replacement 证据并退役；部分替代只移除对应责任。

## 维护与验证

按[维护步骤](../../docs/maintenance.md)更新准确 before／after、载荷和依赖闭包，再在另一个干净固定基线 checkout 正式全量 check／apply 并核对应用 tree。

[tests.json](tests.json) 是非空合同：真实 SDK 的两种 PTC 入口、缺 manifest、JSON-string 参数、准备后新增文件、无 RAG、不可达服务、scope、取消和重试；保留共享 host、旧 fileSearch、工具定义、ToolService、initialize 和任务 callback 回归。仅 HTTP、外部代码执行环境与存储边界使用夹具。

依赖组的跨仓 callback 回归需要设置 `CODER_MODULES_CHECKOUT`，指向包含 `opencode/tests/callback-fixture.mjs` 的既有 coder-modules checkout；缺少时该用例会跳过，runner 会将合同判为未完整通过。

```sh
python3 tools/patchset.py test --target /path/to/application --only file-search-provisioning --tier all --plan
python3 tools/patchset.py test --target /path/to/application --only file-search-provisioning --tier focused
python3 tools/patchset.py test --target /path/to/application --only file-search-provisioning --tier types
python3 tools/patchset.py test --target /path/to/application --only file-search-provisioning --tier project
```

`--plan` 不执行测试。重型检查串行，project 在审查并提交应用后对固定基线运行；Lighthouse 使用隔离本地 Mongo／Express 与生产前端构建，不连接部署服务。
