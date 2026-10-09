# Repaired agent SDK

`librechat-agents-4.0.4-ricky.1.tgz` is built from the sibling
`Ricky-Hao/agents` fork, baseline `97b2db3a` (upstream 4.0.4; release tag
`v4.0.4` at `0a3ae2e`). The baseline includes the invoke empty-stream fix.
The local repair adds skill provenance carriers, fail-safe compaction,
assistant phase preservation and an allowlisted structural projection.
Source commit: `b4aa1e4bbfd96a92e2aebb8426f1e839478def89` in
`https://github.com/Ricky-Hao/agents`, branch `fix/context-provenance-phase`.
The packaged source and ESM/CJS/type artifacts were verified against this repair tree.

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
sha256sum vendor/librechat-agents-4.0.4-ricky.1.tgz
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
both API consumers. It makes no provider or database calls. `agents.json` records
the reviewed artifact identity and checksum for both this verifier and the E2E
locked-origin policy; update it when intentionally replacing the artifact.

SHA-256: `7c87d4e1234ea21b4c07c56e8428a036c1c00d2cf812c58ae661068131e64320`.
