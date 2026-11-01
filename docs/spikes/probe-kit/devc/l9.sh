#!/usr/bin/env bash
# L9 devcontainer probe: runs INSIDE the container as the non-root remote user. Evidence only, no login needed.
set -u
step(){ printf '\n### %s\n' "$*"; }
strip(){ sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -vE '^\s*$'; }

step "env"; id; node --version; uname -sr; cat /etc/os-release | grep -E '^PRETTY'

step "install claude code (native installer)"
curl -fsSL https://claude.ai/install.sh | bash >/tmp/cc-install.log 2>&1; tail -1 /tmp/cc-install.log
export PATH="$HOME/.local/bin:$PATH"; claude --version

step "pinned project-scope plugin install (no login)"
mkdir -p ~/proj && cd ~/proj && git init -q 2>/dev/null
claude plugin marketplace add /workspaces/devc/mkt --scope project 2>&1 | tail -1
for p in superpowers caveman ponytail andrej-karpathy-skills; do claude plugin install "$p@cw-spike" --scope project 2>&1 | tail -1; done
python3 - <<'EOF' 2>/dev/null || node -e 'const d=require(process.env.HOME+"/.claude/plugins/installed_plugins.json");for(const[k,v]of Object.entries(d.plugins))for(const i of v)console.log(k,i.scope,i.gitCommitSha)'
import json,os
d=json.load(open(os.path.expanduser("~/.claude/plugins/installed_plugins.json")))
for k,v in d["plugins"].items():
    for i in v: print(k,i.get("scope"),i.get("gitCommitSha"))
EOF

step "claude-mem pinned installer (non-interactive, output captured)"
cp ~/.bashrc /tmp/bashrc.before 2>/dev/null || touch /tmp/bashrc.before
timeout 600 npx -y claude-mem@15.8.0 install --provider claude --no-auto-start </dev/null >/tmp/cm-install.log 2>&1; echo "installer exit=$?"
strip </tmp/cm-install.log | grep -E "Installation Complete|Version:|Cloud sync|Auto-memory|error|Error|fail" | head -8
echo "agent-directed lines in installer output: $(grep -c '^ *AGENT:' /tmp/cm-install.log)"
echo "bashrc diff:"; diff /tmp/bashrc.before ~/.bashrc
command -v claude-mem; ls ~/.bun/bin/bun 2>/dev/null; command -v uv

step "telemetry: default -> disable -> verify"
npx -y claude-mem@15.8.0 telemetry status </dev/null 2>&1 | strip | grep -E "Telemetry:|Decided by"
npx -y claude-mem@15.8.0 telemetry disable </dev/null 2>&1 | strip | head -1
npx -y claude-mem@15.8.0 telemetry status </dev/null 2>&1 | strip | grep -E "Telemetry:|Decided by"
echo "override check: CLAUDE_MEM_TELEMETRY=1 ->"; CLAUDE_MEM_TELEMETRY=1 npx -y claude-mem@15.8.0 telemetry status </dev/null 2>&1 | strip | grep -E "Telemetry:|Decided by"

step "worker start + health"
export PATH="$HOME/.bun/bin:$PATH"
timeout 180 npx -y claude-mem@15.8.0 start </dev/null 2>&1 | strip | tail -1
sleep 3
PORT=$(node -e 'try{const s=require(process.env.HOME+"/.claude-mem/settings.json");console.log(s.CLAUDE_MEM_WORKER_PORT||"")}catch{console.log("")}')
echo "configured worker port: ${PORT:-<unset>}"
for p in ${PORT:-37700} 37777; do echo "port $p -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$p/api/health) $(curl -s http://127.0.0.1:$p/api/health | head -c 120)"; done
echo "listeners:"; (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E ':(377[0-9]{2}|8000)\b' | awk '{print $1,$4,$NF}' | cut -c1-120
echo "chroma on 8000? $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/v2/heartbeat)"
