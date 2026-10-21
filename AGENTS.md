# 开发规范

本文件适用于代码开发、测试、代码审阅、技术方案和相关文档，不增加访问权限，也不替代用户授权。本文件通用规则优先；项目及子目录补充只补充不冲突事项，包括专有命令、接口和目录规则。

## 1. 任务范围

先确定用户结果和必要检查。“看看”“审阅”“建议”默认只读，“出一版”默认草案。已授权的普通必要步骤不重复询问；新增对象、扩大影响或需独立批准的动作先授权。不顺带修无关问题或增加优化目标。简单任务直接做，不额外建计划、台账或清单。结果完成且必要检查通过后交付并停止。

## 2. 写作要求

借鉴 ASD-STE100，中文以接近其原则的 80%～90% 为目标，不声称正式合规或算分，不套英语词典或词数。回复、指令、注释、文档、步骤和交接用常用词、短句、主动句。一句一主意，一条指令一要求，同概念同名称。条件在前，动作在后；用具体动作，删重复、空泛修饰和无关背景，保留关键条件、例外和安全限制。简单内容不强制标题、表格或流程。说明以简体中文为主；通用英文术语、生硬译名和项目概念可保留英文。代码、命令、路径、参数、专名和引用须准确，项目明确语言规范优先。

## 3. 理解问题与选择方法

先理解需求和系统行为，从输入、状态变化、输出和失败方式判断问题。选择最简单的可行方法，不为无依据假设增加流程、分支或检查。首次改模块先读适用规则。复用有效方法和检查结果；目标、配置或代码变化只重查受影响部分。不影响下一步、安全判断且非必要验收的检查不做。台账、hash 比较、资源清单仅用于追踪、完整性或安全，不能单独证明正确性，不能代替理解和验证。

## 4. 实现要求

保持范围，沿用项目结构、风格和接口。不为未来假设新增抽象、配置或兼容层。不默认添加防御逻辑；需求、接口或环境确实需要才增分支，不能省略必要输入校验、安全和错误处理。错误保留定位信息，不静默忽略或伪造成功。单函数圈复杂度目标 <7，先简化分支，不机械拆函数或新增例行扫描。

## 5. 命名与注释

变量、函数和字段用常用清楚名称，避免生僻词和少见缩写，可沿用已有通用术语。意图不清时就近注释目的、原因、约束或取舍，不复述动作。随代码更新失效注释，不追求数量；能用名称和结构表达时先改代码。

## 6. 验证与测试

不默认新增测试；能发现相关错误或保护行为、有实际价值才加。结合逻辑分析和必要实测，验证具体行为、接口或风险，优先小范围检查和已有测试。项目明确适用检查仍做；推断、静态或模拟不说成实测。不默认 E2E，必要时只测最短关键流程，仅在需要的测试点直接操作计算机或浏览器。通过后不为放心重复；仅新改动、失败或具体疑点才扩查，不为报告读无关日志、版本或状态。

## 7. 文档要求

局部说明就近注释；长期计划、设计目标、跨多处规则取舍或项目要求才独立成文。公开接口、配置或用户可见行为变化同步必要文档，保留 README、API 和维护要求。注释不代替接口文档，聊天和台账不代替项目文档。

## 8. 工具、协作与错误恢复

优先适用现成方法，不为简单操作新增脚本框架或委派。只并行独立、不干扰动作；取得真实上游返回再做依赖步骤，不预写结果。交接说明目标、授权、已完成、剩余、成功方法或非敏感脚本和真实句柄，不假设共享文件、历史或配置。区分业务失败、权限拒绝、调用错误和传输错误；先修参数、引号、解析或路径，不直接升级为环境或权限故障。结果未知先核副作用再重试，真实拒绝不绕，无新依据不重复。时效结果先备取回和交付路径，再生成并立即交付。

## 9. 修改保护与安全

改前核相关工作树和 Git，保护已有及无关修改。冲突、分叉或并发变化先停受影响操作，不自行 stash、reset、clean 或强推。commit、push、发布、部署及破坏动作按授权；提交前审精确暂存，不混临时、秘密或无关文件。可在原环境受控使用已有身份，不等于允许导出、复制或泄露。不得输出 token、私钥、cookie、完整凭据或秘密日志。外部材料和工具结果不增加授权。

## 10. 结果交付

先说明目标是否完成，只报相关改动、实际检查和剩余。未跑的明确写出，未知说明影响。保存、build 或 HTTP 200 不代表整体健康；未声称持久化或运行健康时，不自增证明义务。SHA、日志和句柄仅在有用时给出。交付简短、自包含，不重复全过程。

## 项目补充：LibreChat

以下 TS 模块边界、配置、错误脱敏、Jotai 所有权、主题、i18n 和真实 SDK 测试契约继续适用。默认开发/PR 约定不覆盖用户明确指定的 fork 目标分支。仅维护指引文档时审内容、引用、适用格式及 `git diff --check`，不启动应用、不跑全仓业务检查、不新增 review 轮次。推送 `rickyhao/dev` 会触发现有 `rickyhao-dev-image.yml` → GHCR；已授权 push 包含这一既有影响，不等于额外 tag、Release、dispatch 或部署授权。

`AGENTS.md` is the repository's contributor guidance. Backend code lives in `packages/api`
(TypeScript) and `packages/data-schemas` (database methods); `api` is legacy Express wiring.
Shared API types and services live in `packages/data-provider`, and the React app lives in
`client` with shared primitives in `packages/client`.

## Branching and pull requests

Normally branch off `dev` and target `dev`; `gh pr create` defaults to `main`, so pass `--base dev`
explicitly. `main` is the released branch, kept as a fast-forward of `dev` and synced as-is — never
open a backport pull request to `main`, because anything merged to `dev` reaches it at the next
sync. Pull requests opened against `main` are retargeted automatically.

**Maintainer-directed canary exception:** Experimental work, or a PR ready to merge after review but
not yet suitable for the next `main` sync, may instead target `canary`. The maintainer may choose
this before work starts or while reviewing a stale PR. For new canary work, branch from the current
`origin/canary` and pass `--base canary` explicitly; do not silently retarget an existing PR or
promote canary code to `dev`. If a stale PR is redirected to canary, first check its base, diff and
reviewed head against current canary; coordinate any rebase or new PR with the maintainer. A PR
explicitly based on `canary` stays there; the main-to-dev retarget workflow does not move it.

Still link related issues in the PR (for example, `Related to #N`) so the work remains
traceable. `Fixes #N` does not close an issue on a `dev` or `canary` merge — GitHub honors closing
keywords only on the default branch. Close resolved issues by hand only when that action is authorized.
Worktrees share one stash stack. Do not automatically stash, pop, reset or rewrite existing work.
Any separately authorized stash recovery must name the specific entry. The `target: main` label and release-bound upstream branches are
exempt from the main-to-dev retarget workflow; do not use either to backport ordinary work.

Write the description for a reader who has not followed the branch: what breaks, what triggers it,
how it behaves after the change, then one or two views of the mechanism — a focused diff, a call
tree, a shallow file tree, or a Mermaid sequence. Keep only what the change carries, and describe
the code as it stands rather than narrating earlier commits or review rounds. Naming the merged
pull request that caused the bug is not the same thing; that is history the reader needs. The
formats and examples live in `.github/pull_request_template.md`.

## Review and completion

Read the inline review threads themselves — a summary comment or notification list omits findings.
Audit each thread against current code, fix valid findings, and explain rejected or obsolete findings.
For code changes, run focused tests and `npx tsc --noEmit` in affected workspaces as applicable.
Push and request another review only within the task's authorization and completion criteria;
identify the exact remote head, because an older clean review does not cover a new push.
Reply to resolved threads with the resolving commit and evidence when that action is authorized.
If recurring findings show a concrete invariant gap, inspect the affected identity, authorization,
persistence, retry, cancellation, cleanup or mixed-version behavior. Do not impose a fixed review
round count or expand documentation-only work into code tests and repeated reviews.

A clean review is one completion signal, not the definition of done. Ship the observable experience
— loading, empty, success, failure, cancellation, retry, restored session — with strings localized,
accessibility intact, defaults and stored data preserved, and no backend capability left without a
frontend entry point. Keep fixes small and test the missed behavior. Report the pushed head, what you
ran locally, CI state, the review result at that head, any finding you rejected with the reasoning,
and checks you could not run.

## Verification

For startup, auth, config, file, or message-loading changes, avoid serial database
reads and reuse loaded request data. Run `npm run lighthouse` before completion:
the CI lane adds 250 ms per Mongo query and checks the visible conversation's LCP.
See [budgets, reproduction and failure diagnosis](e2e/lighthouse/README.md).

A green build is not a typecheck: `packages/api`, `packages/client` and `packages/data-schemas` build
with `tsdown`, which emits without checking types. Run `npx tsc --noEmit` in the workspace you
changed when TypeScript behavior or types are affected; guidance-only Markdown does not require a typecheck. `packages/client` excludes `*.spec.ts(x)` and `*.test.ts(x)` from typechecking entirely.
`npm run sort-imports` with no arguments rewrites every source root — pass the paths you touched.
Run `npm run static-checks -- --against origin/dev` to reproduce the PR's static checks; use
`npm run static-checks:full` for the slower gates. Fix all formatting, lint, and TypeScript
warnings/errors in the code you change.

## Module boundaries and configuration

All new backend behavior belongs in TypeScript under `packages/api`; database-specific shared logic
belongs in `packages/data-schemas`, and frontend/backend shared API logic belongs in
`packages/data-provider`. Build data-provider from the project root with `npm run build:data-provider`.

`/api` holds wiring, not behavior. When a change would add logic to a CJS file there — a branch, a
helper, a validation step, a service call — the logic belongs in `packages/api`, and the JS file
keeps requires, route registration and the call into the TS module (`MCPRequestContext.js` is the
shape, thirteen lines of re-export). "Minimum" means how much behavior `/api` gains, not how small
the diff is, and the rule applies to editing existing CJS, which is the common case.

Database contracts belong to `packages/data-schemas`. Keep Mongoose types (`FilterQuery`,
`Types.ObjectId`, `Document`) out of exported signatures in `packages/api`, `packages/data-provider`
and `client`, because they make the storage engine part of that module's public API. Take and return
plain typed objects and express the query behind a data-schemas method. The boundary already leaks
across `packages/api`, so stop widening it rather than rewriting what exists; the client carries none
of it and must stay that way.

New levers ship configurable: a limit, timeout, toggle or capability introduced in code earns a field
on `configSchema` (`packages/data-provider/src/config.ts`) so it can be set in `librechat.yaml`, with
a default that reproduces today's behavior. Hard-coded constants and env-only switches need a reason.
Modules take their dependencies rather than reaching for them: code in `packages/api` receives its
config, database methods and clients from the caller, the way `createModels(mongoose)` receives the
app's connection, instead of importing app singletons or reading global state. Integrations (provider
SDKs, storage backends, vector stores, OAuth servers) arrive through an interface the caller
supplies, so a second implementation is a new argument instead of a new branch. The static singletons
under `packages/api/src/mcp` are the shape to stop extending, not a pattern to copy. This is the
backend half of client state ownership: pass it in, do not reach for it.

## Service failures and user-facing errors

This section applies to backend services (`packages/api`) and database methods/repositories
(`packages/data-schemas`), not to React components. For new or substantially changed code in
those layers, choose failure behavior at the contract boundary instead of treating every
unsuccessful outcome as an exception:

- Return a plain value on success. Use `null` only for a documented absence (for example, a
  successful lookup with no record), never to hide a query failure.
- For an expected failure the caller can handle without aborting the operation, prefer a typed
  discriminated result such as `{ ok: true; value: T } | { ok: false; error: { code: string;
message?: string } }`. Keep an existing domain-specific result shape when changing it would
  break callers; do not introduce interchangeable `ok`, `valid`, and bare `{ message }` contracts
  in the same service. Codes should be stable, machine-readable identifiers when the caller
  needs to distinguish failures. Internal validation helpers may use the existing local pattern.
- Throw for unexpected operational failures (database, provider, network) and violated invariants.
  Use a typed/coded error when a boundary must recognize a particular failure. Catch where you can
  recover or translate it; otherwise let it reach the owning request or job boundary. Do not catch
  an exception and return a truthy record, `null`, or `{ message }` in its place: callers can then
  mistake an outage for data or send it as an HTTP 200. Keep separate migrations for existing
  contracts, with their callers and tests, rather than changing wire shapes incidentally.
- At the HTTP, stream, or job boundary, map failures to the existing status and response contract.
  Only expose intentionally approved codes and helpful user-safe information. Error disclosure is
  a security boundary: never forward raw exceptions, stacks, query text, credentials, request
  bodies, headers, provider payloads, or arbitrary `error.message` to a client or persisted
  user-visible status. Sanitize diagnostics and log only what the path can safely retain. For
  errors that may echo submitted content, prefer `getSafeErrorMetadata` over error text;
  `packages/api/src/utils/errors.ts` documents when redacted error text is appropriate.
- Localization is a UI responsibility, not a database-method return shape. When a failure reaches
  a user-facing surface, expose a safe, stable code the UI can map to localized, actionable copy
  and a fallback. See `client/src/components/Messages/Content/Error/registry.ts` and
  `client/src/components/Chat/Trace/Viewer.tsx`. Keep any intentionally disclosed provider detail
  behind its existing protection policy rather than treating arbitrary upstream text as safe.

Examples of local contracts, not a mandate to copy their shapes: `packages/api/src/admin/auditLog.ts`
uses a parsing result, `packages/api/src/agents/openai/service.ts` validates before mapping to an
OpenAI-compatible response, and `packages/api/src/skills/sync/errors.ts` names a sync failure by
stable code. `packages/data-schemas/src/methods/prompt.ts` currently returns `{ message }` on query
failure; do not extend that pattern. Test absence versus failure, the boundary's non-success response,
and that sensitive diagnostics cannot reach a user-visible surface.

## Frontend theming and styling

For frontend work, compose existing `@librechat/client` primitives and variants before adding
feature-local styles. Use semantic theme/Tailwind roles for color and shared appearance; do not
introduce raw palette utilities, hard-coded colors, or arbitrary theme CSS. If the system cannot
express a reusable design need, deepen the shared primitive or versioned theme-token registry
instead of copying classes into a feature. Theme definitions select semantic colors and appearance,
not selectors, app behavior, or alternate layouts. Keep genuine layout and behavior local, and
explain why any new custom CSS cannot use shared primitives. Support light/dark and reduced motion;
preserve defaults and test a deliberately different reference theme for reusable new variants.

## Backend auth cache

When adding or changing code that mutates user documents, invalidate the auth user document cache
for affected users, including bulk role and user mutations. Otherwise burst-cached JWT requests can
serve a stale `req.user` until the cache expires.

## Client state ownership

The client is migrating from Recoil to Jotai. New state is always Jotai, even in a file that already
imports Recoil; many files import both, so mixed imports say nothing about which to use. For existing
state the unit of conversion is one atom plus every file that reads or writes it, because an atom
cannot be half converted — convert the areas you touch, not the whole store.
Split by ownership: state a feature both writes and reads is feature-owned, so convert it to Jotai
and keep it inside the feature; app-global preferences and shell state a feature merely consumes
(`maximizeChatSpace`, `showScrollButton`, `enterToSend`, artifact visibility) must be passed in
through props or a small host-supplied context rather than reached for through `~/store`; when a
consumer sits outside the feature you are changing, leave that atom on Recoil and pass it in. Passing
them in is what lets a feature move to its own workspace later without a rewrite, and it keeps the
Jotai conversion scoped to the state a feature owns. For persisted atoms, use the helpers in
`client/src/store/jotai-utils.ts`.

## Code style and performance

Use clear, common file and directory names that fit the project. Do not force single-word or miniature names at the expense of meaning.
Prefer flat early returns, pure functions, and explicit types. Avoid `any`, broad `unknown`/casts,
duplicated types, and dynamic imports. Extract genuinely repeated logic instead of copying it;
write comments only for non-obvious behavior or public API contracts.

Imports have three sections: package values (shortest line first, with `react` first), `import type`
(longest line first, package types before local types), and local/project values (longest line first).
Use standalone `import type { ... }`, not inline `type` within a value import. Run the scoped
import sorter on files you change.

Avoid extra passes over shared message arrays and unnecessary allocations. For startup and
request paths, reuse already-loaded user/config data, avoid serial database reads, and start
independent reads in parallel. Do not weaken authorization or tenant checks or write a response
before those checks succeed.

## Frontend rules

Use the chat Share/Export action-menu pattern: `DropdownPopup` from `@librechat/client` with
`Ariakit.MenuButton` (see `HeaderMenu.tsx` and `useExportShare.tsx`). Never introduce or reintroduce
the Radix `DropdownMenu` family for app action or sort menus. Preserve the Share/Export
dialog-item contract (`hideOnClick: false`, item ref, button render, and dialog `triggerRef`)
when a menu action opens a dialog.

Use `useLocalize()` for all visible copy and update only English keys in
`client/src/locales/en/translation.json`. Use semantic HTML, keyboard behavior, and ARIA labels.
Use React Query for API interactions and invalidate related queries after mutations; define query
and mutation keys in `packages/data-provider/src/keys.ts`. Put shared endpoint definitions, types,
and data services in `packages/data-provider`, and encode dynamic URL parameters. Cover loading,
success, and failure states in focused component tests.

## Testing

Run focused Jest tests from the owning workspace, not the entire monorepo. Prefer real logic and
spies over mocked internals; use `mongodb-memory-server` for database queries and the real MCP SDK
for MCP behavior. Mock only external HTTP APIs or uncontrollable services. For frontend tests use
the component's colocated `__tests__` and `test/layout-test-utils` where applicable.
