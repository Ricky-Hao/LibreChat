# Vendored agent SDK

`librechat-agents-4.1.1-ricky.1.tgz` is built from clean merged `main` commit
`6939842a19a26681b9093ccffb52433636fa4df7` (tree
`7e3ec48079ca4f19be36ee6f3952a093b6cb50b7`) in the sibling
`https://github.com/Ricky-Hao/agents` fork. Its parents are the previous fork
head `ffd8a8e2bc888939038ce8e7f0c23f8dc971a456` and fixed upstream 4.1.1
commit `c56fc5eb7d141a25976c1886520ab4dac745ae07`.
`agents.json` records its artifact and patch SHA-256. Applying
`agents-4.1.1-ricky.1.patch` to that upstream commit reproduces the merged tree,
including the regression tests. Packaged source files match the commit.
`source.dirty: false` and `source.buildState: clean-commit` describe this build.
This is a local review artifact, not a registry release or a deployed fix.

Version 4.1.1-ricky.1 retains the fork's summary/reasoning, assistant phases,
Skill provenance, PTC intent/error status, artifact guidance and Langfuse
scope/redaction repairs. It adds upstream provider compatibility, schema
conversion, local tool selection/result caps, and lightweight decision/rerank
exports. Zod 3 and both early/current Zod 4 schemas remain supported; this is
not a public-type migration. The existing Zod/deepmerge audit findings are not
fixed by this update.

The retained 4.0.4-ricky.5 artifact was built from clean `main` commit
`ffd8a8e2bc888939038ce8e7f0c23f8dc971a456` (tree
`0faddd4544dd410ebf545961f6abaae3c13e4b66`), after
[PR #3](https://github.com/Ricky-Hao/agents/pull/3).
Its patch base is `24ca27d4c9acac3b332822569a12bd13e24a941a`.
Its tarball SHA-256 remains
`fe9dbfa083cfde285e7ae1941ec39a9d47a5b500df5e14134477505d9b4195aa`;
its patch SHA-256 remains
`61ea2fc74e3a888c6f1f2be9f6203aff8c9035467279ee6eaa5a8d9cf6fb2ffc`.

Version 4.0.4-ricky.5 separates internal processing from file delivery in the public
PTC system instructions, tool descriptions and code parameters. Prefer memory,
or unique same-call `/tmp` scratch with cleanup. Managed `/mnt/data` is retained
across calls and automatically collected/displayed; use it only for requested
files, necessary deliverables or unavoidable cross-call storage. A callback
completion notice does not request report copies, prompts or bridge scripts.
The Bash parallel example retains `raw=$(tool ...)` capture and uses a unique
temporary directory instead of persistent SF/NY result files. Requested HTML
delivery remains supported. Attached workspaces keep durable project files in
the authorized project and use `${LIBRECHAT_CODE_DATA_DIR:-/mnt/data}` only for
execution-scoped artifacts. No collector, delivery protocol or callback logic
has changed.

The retained ricky.4 artifact was built from clean commit
`4f396f5b420d3d23fee673b6ee20420dfc902dae` (tree
`666a2ea72e11edb8a198cd7cb793ba7fc0f1b669`), branch
`fix/summary-reasoning-content`. Its patch also uses base
`24ca27d4c9acac3b332822569a12bd13e24a941a`.
Its tarball SHA-256 remains
`d848eeda3754f3b8277c9c78838071a1502f445ff47ab4377589590f712660eb`;
its patch SHA-256 remains
`606d31c69b9ddcf1e5fce43699e52827e424cb6e8d580e887d080e413035ecdb`.

Version ricky.4 normalizes structured reasoning at the SDK chunk boundary.
Summary deltas contain ordered content-block arrays, never raw reasoning objects.
Empty reasoning does not hide body text or create an empty delta. Structured
reasoning exposes only its summary text; the completion event replaces temporary
reasoning with the final summary body. The persisted summary excludes that reasoning.

The artifact retains the prior repairs from the sibling
`Ricky-Hao/agents` fork, baseline `97b2db3a` (upstream 4.0.4; release tag
`v4.0.4` at `0a3ae2e`). The baseline includes the invoke empty-stream fix.
The local repair adds skill provenance carriers, fail-safe compaction,
assistant phase preservation and an allowlisted structural projection.
Version ricky.2 also normalizes UI-only intent against the real callee schema
for Python/Bash tool execution, sharing the helper with direct LibreChat calls.
Schema inspection is bounded and contains unsafe getters/proxies behind a fixed
error before invocation. Unresolved references preserve business `intent`;
the execution validator still enforces the schema. Local references are not fetched
or resolved by the cleanup helper.

The retained ricky.3 artifact was **built from uncommitted source**, based on
`6e92e46793e2b2d5fb424d78e42dc71a83c3a5c7` in
`https://github.com/Ricky-Hao/agents`, branch `fix/ptc-intent-init-diagnostics`,
plus `agents-4.0.4-ricky.3.patch` (including new regression source).
That exact source tree is committed as
`b45b8a8ebcb8e47219201bf7660c8527d0f9be67` (tree
`cc5d36ee6e468e2738e78081e92e3561ad0aa7c6`). Applying the ricky.3 patch to its
base reproduces that tree. Its historical build provenance remains uncommitted;
the later source commit does not change how its artifact was built. Its reviewed
bytes are unchanged (SHA-256
`80991f03d885d6cdd76b176afd77c94747ce28bb1df3efcc2eb37ece2ae71913`).
The ricky.1 and ricky.2 artifacts and prior patches are also retained.
The ricky.2 source is committed at the ricky.3 base above.

Version ricky.3 maps known ToolMessage and MCP protocol errors to PTC `is_error`
before Python/Bash continuation submission. It preserves failure payloads, mixed
rich content and nonempty artifacts, and shares the status adapter with LibreChat
PTC instrumentation. New error summaries are fixed text, not raw tool content.
Explicit error envelopes retain failure status beside typed artifacts. Nonplain
artifacts (including Date values) are preserved without invoking serialization hooks.
Non-MCP successes retain their original result envelope.
Business `status`/`error` fields, HTTP-like objects and arbitrary JSON strings are
not interpreted as protocol failures. The CodeAPI wire protocol is unchanged;
host tests verify submission, not the deployed backend's shell exit behavior.

Both API workspaces use this file dependency. Do not replace it with an npm
link, an edited node_modules copy, or the stock registry package. Docker copies
this directory before npm ci. No registry publishing is required.

Regenerate only from a clean SDK commit merged into `main`, with Node 24.
Confirm the exact merged SHA before building; reuse an unchanged valid dependency
installation or run the `npm ci` step below:

```sh
cd /workspaces/agents
npm ci --ignore-scripts
npm run build
npm pack --ignore-scripts --pack-destination /workspaces/LibreChat/vendor
cd /workspaces/LibreChat
npm install --ignore-scripts --no-audit --no-fund
npm ls @librechat/agents zod zod-v4 zod-to-json-schema --all
sha256sum vendor/librechat-agents-4.1.1-ricky.1.tgz
node vendor/verify-agents.mjs
```

Use a new fork version for each subsequent reviewed artifact. Do not overwrite a
used tarball or patch. Update both API manifests and the lock resolution/integrity
for the new artifact before reinstalling it.

Verify the new lock with a clean `npm ci` as well. A tarball update can retain a
stale nested Zod entry: the SDK must resolve its declared Zod 3, while
`@langchain/openai` resolves its own Zod 4. Do not mask an invalid tree with an override.

The artifact includes ESM, CJS and declarations, plus public source, license and
README. The package allowlist excludes tests, fixtures, environment files and
node_modules. `verify-agents.mjs [isolated-install-root]` checks tarball integrity,
absence of nested stock SDK lock entries, and all require/import subpaths from
both API consumers, including installed Zod 3/early Zod 4/current Zod 4 schema
conversion and summary-reasoning/intent/result-status behavior,
managed/attached artifact guidance, public PTC system instructions in CJS/ESM,
and declaration exports.
It makes no provider or database calls. `agents.json` records
the reviewed artifact identity and checksum for both this verifier and the E2E
locked-origin policy; update it when intentionally replacing the artifact.

Regeneration must also refresh the source patch, its digest, the artifact digest
and lock integrity. Build from the committed source after all SDK edits. To reproduce this snapshot,
apply the patch to the recorded base in a clean checkout before building with
Node 24, or check out the matching `source.committedSource.commit`. Retain the
historical build provenance when recording a later matching source commit;
do not relabel an artifact built from uncommitted source as a clean-commit build.
Space-only empty context lines in the stored patch are normalized to blank
lines (accepted by `git apply`) so the provenance file passes whitespace checks.

SHA-256: `8846c95757723cc78b39f3a0dd5c0f2d9edf537bd6c4dc86d3834a63a6882441`.
