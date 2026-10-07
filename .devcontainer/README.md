# Development and local testing

## Fresh image

The default `devcontainer.json` builds the Dockerfile directly, so Coder Envbuilder does
not need Docker Compose or a Docker socket. It does not set `workspaceFolder`: the
container host's clone/mount location remains authoritative (including
`/workspaces/LibreChat`). The image contains:

- Node **24.16.0** (checked against `.nvmrc`) and the npm version from
  `package.json#packageManager` (**11.13.0** currently).
- Git, OpenSSH client, CA certificates and curl; Python, make, C++ and pkg-config for
  native npm modules when a prebuilt binary is unavailable.
- Chromium OS libraries/fonts installed by the **lockfile's** Playwright CLI.
  Debian bookworm is supported by current Playwright and supplies `libssl3`/`libcurl4`
  for the memory-Mongo binary; the older bullseye base is not used.

`postCreateCommand` runs `bash .devcontainer/setup.sh` from the checkout. It checks
runtime pins and ownership, performs `npm ci --include=dev`, installs the matching
Playwright Chromium (including headless shell), and pre-downloads the locked
memory-Mongo package's binary. Downloads require registry/browser/Mongo distribution
access. A failure exits nonzero; rerunning the command is safe after fixing it.
No app, database, model service, or AI tooling is started or installed by the hook.
Husky installation is disabled for this hook to preserve the host's Git configuration.
OpenCode/acpx/provider/MCP tooling remains owned by the surrounding Coder template.

VS Code executes the hook as `vscode`; Envbuilder may execute it as root. Dependencies
and the default browser/Mongo caches belong to the **actual executing user** and its
HOME. Keep the same user for setup and tests. A mismatched HOME owner or mixed-owner `node_modules` fails before
installation; the hook never recursively changes ownership of a mounted checkout.
Do not switch between root and vscode on one installed tree. User/volume provisioning
belongs to the container host, not this hook.

## Existing fallback workspace

Editing this Dockerfile does not update an already-running container. A fresh image
build/recreation is needed for the base and OS packages; rerunning the setup hook only
installs project dependencies/binaries and cannot repair missing OS libraries or a
different Node/npm runtime. Use the pins above and run the hook as the workspace user
once the host has provisioned the runtime and OS dependencies. No task-local runtime
path is required by checked-in configuration. A passing test in an existing workspace
is not proof that this image built successfully.

## Build and test explicitly

From the checkout, after setup:

```sh
npm run frontend                         # shared packages, then production frontend
npm run frontend:dev                    # optional Vite development server
npm run test:client-build                # three bundle/worker regression tests
node --test .devcontainer/setup.test.mjs # isolated setup/failure/ownership contracts
# Focused Jest and types run in their owning workspace, for example:
(cd client && npx --no-install jest --runInBand src/routes/Overlays.test.tsx)
(cd client && npx --no-install tsc --noEmit)
# Reuse the build; fake model, disposable memory Mongo, loopback-only app:
E2E_BASE_URL=http://127.0.0.1:3098 E2E_USE_MEMORY_MONGO=true E2E_STREAM_STORE=memory \
  MONGO_URI=mongodb://127.0.0.1:27017/LibreChat-devcontainer-e2e \
  npx --no-install playwright test --config=e2e/playwright.config.mock.ts \
  retained-prefix.spec.ts mobile-overlay-back.spec.ts streaming.spec.ts
bash .devcontainer/lighthouse.sh         # reuses the production build
```

The memory harness downloads/runs its own MongoDB binary; a Mongo service on 27017 is
not required. Test databases and servers are stopped by the harness. The wrapper finds
Chromium through the installed Playwright package, uses disk-backed shared memory for
small container `/dev/shm`, and adds `--no-sandbox` **only for root's local test process**.
It does not alter Lighthouse budgets, query latency injection, or production sandbox
settings. Non-root execution retains Chrome's sandbox and depends on the host permitting
it. Run server-owning test suites sequentially. See [mock E2E](../e2e/README.md) and
[Lighthouse](../e2e/lighthouse/README.md) for other profiles, budgets and diagnostics.
Browser storage state, traces and failure logs may contain disposable login material;
keep those artifacts local. Do not copy `.env` or production credentials into this image.

## Optional existing Compose setup

`.devcontainer/docker-compose.yml` is retained for hosts that explicitly opt into its
existing MongoDB/Meilisearch development services. It builds this same image and mounts
the repository at `/workspaces`; a Compose-based devcontainer config must use that path,
`service: "app"`, and the same post-create hook. The default build-only config does not
launch these services. The local memory tests above do not need Compose or Redis.

## SSH publication

Use an SSH origin such as `git@github.com:Ricky-Hao/LibreChat.git` for GitHub pushes.
In Coder, use the Git identity and SSH command supplied by the template; this repository
does not install an agent, copy keys, change remotes, or rewrite Git configuration.
The configured origin and host trust remain the operator's responsibility. No GitHub
token is needed for SSH Git operations. Initialization never fetches or pushes commits.
