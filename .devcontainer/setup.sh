#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

expected_node="v$(cat .nvmrc)"
expected_npm="$(node -p 'require("./package.json").packageManager.replace(/^npm@/, "")')"
if [[ "$(node --version)" != "$expected_node" || "$(npm --version)" != "$expected_npm" ]]; then
  echo "Expected Node $expected_node and npm $expected_npm; rebuild the dev image or select the repository-pinned runtime." >&2
  exit 1
fi

# VS Code runs this as vscode; Envbuilder may run it as root. Install as that actual
# user, with its own HOME/cache. Refuse mixed ownership instead of repairing volumes.
uid="$(id -u)"
if [[ ! -w . || ! -w "$HOME" || "$(stat -c %u "$HOME")" != "$uid" ]] \
  || [[ -e node_modules && "$(stat -c %u node_modules)" != "$uid" ]]; then
  echo 'Setup needs a writable checkout and HOME/node_modules owned by the executing user.' >&2
  exit 1
fi

# Keep the host's existing Git configuration; Husky's prepare hook otherwise rewrites it.
HUSKY=0 npm ci --include=dev --no-audit --no-fund
node node_modules/playwright/cli.js install chromium
# Pre-download the version selected by the locked package. This does not start MongoDB.
node -e 'require("mongodb-memory-server-core").MongoBinary.getPath().catch(() => { console.error("Memory Mongo binary download failed; check network access and cache permissions."); process.exit(1); })'
echo 'Development/test dependencies installed. No app or database service has been started.'
