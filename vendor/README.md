# Repaired agent SDK

`librechat-agents-4.0.4-ricky.2.tgz` is built from the sibling
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

The artifact was **built from uncommitted source**, based on
`a21e4522049511700bd0ec70d666e39332c3b90d` in
`https://github.com/Ricky-Hao/agents`, branch `fix/ptc-intent-init-diagnostics`,
plus `agents-4.0.4-ricky.2.patch` (including new regression source).
`agents.json` records its SHA-256. The base differs from the previous artifact's
source `b4aa1e4bbfd96a92e2aebb8426f1e839478def89` only in the publish workflow.
That exact source tree is now committed as
`6e92e46793e2b2d5fb424d78e42dc71a83c3a5c7` (tree
`57a7c3b7fddfb7342a91a834e4feafc0cef47cc6`). `agents.json` records it in
`source.committedSource`; `source.dirty` and `source.buildState` describe the
historical build, not the current SDK worktree. Applying the recorded patch to
the base reproduces the full committed tree, and all packaged source files match
that commit. The artifact has **not been rebuilt**: its reviewed bytes and checksum
are unchanged. The old ricky.1 artifact is retained.

Both API workspaces use this file dependency. Do not replace it with an npm
link, an edited node_modules copy, or the stock registry package. Docker copies
this directory before npm ci. No registry publishing is required.

Regenerate after all SDK edits, with Node 24:

```sh
cd /workspaces/agents
npm ci --ignore-scripts
npm run build
npm pack --ignore-scripts --pack-destination /workspaces/LibreChat/vendor
cd /workspaces/LibreChat
npm install --ignore-scripts --no-audit --no-fund
sha256sum vendor/librechat-agents-4.0.4-ricky.2.tgz
node vendor/verify-agents.mjs
```

If replacing an artifact with the same version during review, refresh the SDK
lock entry's integrity from the new npm pack result and reinstall that package;
npm may otherwise reuse the prior tarball integrity. Prefer a new fork version
for subsequent reviewed releases.

The artifact includes ESM, CJS and declarations, plus public source, license and
README. The package allowlist excludes tests, fixtures, environment files and
node_modules. `verify-agents.mjs [isolated-install-root]` checks tarball integrity,
absence of nested stock SDK lock entries, and all require/import subpaths from
both API consumers, including intent behavior in CJS/ESM and declaration exports.
It makes no provider or database calls. `agents.json` records
the reviewed artifact identity and checksum for both this verifier and the E2E
locked-origin policy; update it when intentionally replacing the artifact.

Regeneration must also refresh the source patch (tracked and untracked changes),
its digest, the artifact digest and lock integrity. To reproduce this snapshot,
apply the patch to the recorded base in a clean checkout before building with
Node 24, or check out the matching `source.committedSource.commit`. Retain the
historical build provenance when recording a later matching source commit;
do not relabel an artifact built from uncommitted source as a clean-commit build.
Space-only empty context lines in the stored patch are normalized to blank
lines (accepted by `git apply`) so the provenance file passes whitespace checks.

SHA-256: `f23524ac166232df65886b50d62557da701f953f8f05a4d511cfa83cf5c35fc0`.
