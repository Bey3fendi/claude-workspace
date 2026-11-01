#!/usr/bin/env bash
# Phase 1 lifecycle acceptance inside a Linux devcontainer (non-root remote user).
# Expects the workspace repo at $CW_REPO (default /tmp/cw). Prints PASS/FAIL per check.
set -u
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
REPO=${CW_REPO:-/tmp/cw}; CW="node $REPO/cli/bin/claude-workspace.mjs"; P=$HOME/p2
pass=0; fail=0
ok(){ echo "PASS $*"; pass=$((pass+1)); }; ko(){ echo "FAIL $*"; fail=$((fail+1)); }
check(){ local d=$1; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
treehash(){ (cd "$P" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16); }
tel(){ npx -y claude-mem@15.8.0 telemetry status </dev/null 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^Telemetry:' ; }

echo "### env"; id -un; node --version; claude --version; uname -sr

echo "### reset claude-mem to a fresh state (container only)"
npx -y claude-mem@15.8.0 uninstall </dev/null >/tmp/cm-uninstall.log 2>&1; echo "claude-mem uninstall exit=$?"
rm -f ~/.claude-mem/telemetry.json
claude plugin list --json | grep -c '"claude-mem@thedotmack"' | sed 's/^/claude-mem registry entries: /'
echo "telemetry before: $(tel)"

echo "### hermetic suite"
(cd "$REPO" && node --test "tests/**/*.test.mjs" 2>&1 | grep -E '^# (tests|pass|fail)')

echo "### fixture: existing repo with settings + CLAUDE.md"
rm -rf "$P"; mkdir -p "$P/.claude" && cd "$P" && git init -q
printf '# rules\n' > CLAUDE.md
printf '{\n    "model": "opus",\n    "permissions": { "deny": ["Bash(rm -rf:*)"] }\n}\n' > .claude/settings.json
printf 'node_modules' > .gitignore
git add -A && git -c user.name=t -c user.email=t@t commit -qm init
H0=$(treehash)

echo "### install"
$CW install --yes >/tmp/i1.out 2>&1; rc=$?; cat /tmp/i1.out
check "install exit 0" test $rc -eq 0
check "no agent-directed upstream text relayed" bash -c '! grep -qE "AGENT:|cmem\.ai" /tmp/i1.out'
check "claude-mem installed by workspace" grep -q "claude-mem 15.8.0 installed" /tmp/i1.out
check "telemetry DISABLED after install" bash -c "[ \"\$(npx -y claude-mem@15.8.0 telemetry status </dev/null 2>&1 | grep -c 'Telemetry: DISABLED')\" = 1 ]"
check "pins recorded == lock" node -e '
  const lock=require(process.argv[1]+"/workspace.lock.json"); const reg=require(process.env.HOME+"/.claude/plugins/installed_plugins.json").plugins
  let bad=0; for(const p of lock.plugins.filter(p=>p.enabled&&typeof p.source==="object")){const r=(reg[p.name+"@cw-workspace"]||[]).find(x=>x.projectPath===process.argv[2]); if(!r||r.gitCommitSha!==p.source.sha){console.log("mismatch",p.name);bad++}}
  process.exit(bad)' "$REPO" "$P"
check "user settings keys preserved" node -e 'const s=require(process.argv[1]+"/.claude/settings.json");process.exit(s.model==="opus"&&s.permissions.deny[0]==="Bash(rm -rf:*)"&&s.permissions.deny.length===32?0:1)' "$P"
check "CLAUDE.md untouched" bash -c "cd $P && git diff --quiet -- CLAUDE.md"

echo "### idempotency"
H1=$(treehash)
$CW install --yes --json >/tmp/i2.json 2>&1
check "second run: zero changes" node -e 'const d=JSON.parse(require("fs").readFileSync("/tmp/i2.json","utf8").trim().split("\n").pop());process.exit(d.changes.length===0&&d.ok?0:1)'
check "second run: tree identical" test "$(treehash)" = "$H1"

echo "### doctor + telemetry gate"
$CW doctor >/tmp/d1.out 2>&1; rc=$?; grep -E '^(x|!)|doctor:' /tmp/d1.out
check "doctor passes" test $rc -eq 0
CLAUDE_MEM_TELEMETRY=1 $CW doctor >/tmp/d2.out 2>&1; rc=$?
check "doctor fails with env override" test $rc -eq 1
check "failure names the location" grep -q "process environment" /tmp/d2.out
printf '{"env":{"CLAUDE_MEM_TELEMETRY":"on"}}\n' > "$P/.claude/settings.local.json"
$CW doctor >/tmp/d3.out 2>&1; rc=$?
check "doctor fails with settings.local env block" bash -c "[ $rc -eq 1 ] && grep -q settings.local.json /tmp/d3.out"
rm "$P/.claude/settings.local.json"
node -e 'const f=process.env.HOME+"/.claude-mem/telemetry.json",fs=require("fs");const j=JSON.parse(fs.readFileSync(f));j.enabled=true;fs.writeFileSync(f,JSON.stringify(j))'
$CW doctor >/tmp/d4.out 2>&1; rc=$?
check "doctor re-disables telemetry flipped in config" bash -c "[ $rc -eq 0 ] && grep -q 'telemetry disable' /tmp/d4.out && [ \"\$(npx -y claude-mem@15.8.0 telemetry status </dev/null | grep -c 'Telemetry: DISABLED')\" = 1 ]"
check "DO_NOT_TRACK never written" bash -c "! grep -rqs DO_NOT_TRACK ~/.bashrc ~/.profile ~/.zshrc ~/.claude/settings.json $P"

echo "### uninstall"
$CW uninstall >/tmp/u.out 2>&1; rc=$?; cat /tmp/u.out
check "uninstall exit 0" test $rc -eq 0
check "byte-exact restore of the project" test "$(treehash)" = "$H0"
check "git status clean" bash -c "cd $P && [ -z \"\$(git status --porcelain)\" ]"
check "no workspace plugins registered for project" bash -c "! claude plugin list --json | grep -q '@cw-workspace'"

echo "### RESULT: $pass passed, $fail failed"
exit $fail
