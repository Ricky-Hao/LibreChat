FROM node:24.16.0-bookworm

# Keep the base in sync with .nvmrc; fail the build instead of silently using another runtime.
COPY .nvmrc package.json package-lock.json /opt/librechat-dev/
RUN set -eu; \
    cd /opt/librechat-dev; \
    test "$(node --version)" = "v$(cat .nvmrc)"; \
    npm_spec="$(node -p 'require("./package.json").packageManager')"; \
    npm install --global "$npm_spec"; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates git openssh-client curl python3 make g++ pkg-config \
      libcurl4 libssl3; \
    playwright_version="$(node -p 'require("./package-lock.json").packages["node_modules/playwright-core"].version')"; \
    npm exec --yes --package="playwright-core@$playwright_version" -- playwright-core install-deps chromium; \
    rm -rf /var/lib/apt/lists/* /opt/librechat-dev /root/.npm

# Only image-owned directories are created here; never recursively chown a mounted checkout.
RUN useradd -m -s /bin/bash vscode \
    && install -d -o vscode -g vscode /workspaces
WORKDIR /workspaces
