# Body of post-create.sh (install.sh prepends the option values). Runs as the remote user after the
# container is created, in the workspace folder. Never fails container creation: problems are reported
# and the exit code is 0, so the person can fix them and run `claude-workspace repair` by hand.
set -u
log(){ echo "claude-workspace: $*"; }
export PATH="$HOME/.local/bin:$PATH"

if [ "$INSTALLCLAUDECODE" = "true" ] && ! command -v claude >/dev/null 2>&1; then
  v="$CLAUDECODEVERSION"
  [ "$v" = "tested" ] && v="$(cat /usr/local/share/claude-workspace/tested-claude-version 2>/dev/null)"
  [ "$v" = "latest" ] && v=""
  log "installing Claude Code ${v:-latest} (native installer)"
  if ! curl -fsSL https://claude.ai/install.sh | bash -s ${v:+"$v"} >/tmp/claude-code-install.log 2>&1; then
    log "Claude Code install failed (see /tmp/claude-code-install.log)"; exit 0
  fi
fi
command -v claude >/dev/null 2>&1 || { log "'claude' is not on PATH; skipping the workspace install"; exit 0; }

[ "$INSTALLONCREATE" = "true" ] || { log "CLI ready; run 'claude-workspace install' in your project"; exit 0; }
args=(install --project "$PWD")
[ -n "$MARKETPLACE" ] && args+=(--marketplace "$MARKETPLACE")
if claude-workspace "${args[@]}" </dev/null; then
  log "installed; check with 'claude-workspace doctor'"
else
  log "install did not complete (see above); fix it and run 'claude-workspace repair'"
fi
exit 0
