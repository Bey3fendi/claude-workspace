#!/usr/bin/env bash
# Live test of the devcontainer feature (Docker; no Claude model usage): build, create, post-create, doctor,
# idempotent re-install. Run: npm run build:feature && tests/live/devcontainer/run.sh
set -u
export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
T=/tmp/cw-feat-test
docker rm -f $(docker ps -aq --filter label=devcontainer.local_folder=$T) >/dev/null 2>&1
rm -rf $T && mkdir -p $T/.devcontainer && cd $T
git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
cp -r $REPO/devcontainer/src/claude-workspace .devcontainer/claude-workspace
cat > .devcontainer/devcontainer.json <<'J'
{ "name": "cw-feature-test",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22",
  "remoteUser": "node",
  "features": { "./claude-workspace": {} } }
J
git add -A && git -c user.name=t -c user.email=t@t commit -q -m devc
echo "### up"; time npx -y @devcontainers/cli@0.90.0 up --workspace-folder $T --remove-existing-container 2>&1 | grep -E "claude-workspace|error|Error|outcome" | tail -40
echo "### doctor"; npx -y @devcontainers/cli@0.90.0 exec --workspace-folder $T bash -lc 'claude --version; claude-workspace doctor' 2>&1 | tail -40
echo "### second install (idempotent)"; npx -y @devcontainers/cli@0.90.0 exec --workspace-folder $T bash -lc 'claude-workspace install --yes 2>&1 | tail -5'
echo "### host project files"; cd $T && git status --short
