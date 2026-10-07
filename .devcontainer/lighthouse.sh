#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Only this test process uses these settings; production Chrome flags are untouched.
export E2E_BASE_URL=http://127.0.0.1:3098
export E2E_USE_MEMORY_MONGO=true
export E2E_STREAM_STORE=memory
export E2E_REPLICAS=1
export MONGO_URI=mongodb://127.0.0.1:27017/LibreChat-devcontainer-e2e
unset E2E_CHROMIUM_CHANNEL
export CHROME_PATH
CHROME_PATH="$(node -p 'require("playwright").chromium.executablePath()')"
test -x "$CHROME_PATH"
export LIGHTHOUSE_CHROME_FLAGS="${LIGHTHOUSE_CHROME_FLAGS:+$LIGHTHOUSE_CHROME_FLAGS }--disable-dev-shm-usage"
if [[ "$(id -u)" == 0 ]]; then
  export LIGHTHOUSE_CHROME_FLAGS="$LIGHTHOUSE_CHROME_FLAGS --no-sandbox"
fi
exec npm run lighthouse:run -- "$@"
