#!/usr/bin/env bash
# Build-time step of the claude-workspace devcontainer feature (runs as root while the image is built).
# Installs the CLI only. Claude Code, plugins and claude-mem are per-user and per-project, so they are
# installed by post-create.sh as the remote user once the project folder is mounted.
set -euo pipefail
SOURCE="${SOURCE:-bundled}"
MARKETPLACE="${MARKETPLACE:-}"
INSTALLCLAUDECODE="${INSTALLCLAUDECODE:-true}"
CLAUDECODEVERSION="${CLAUDECODEVERSION:-tested}"
CLAUDEMEM="${CLAUDEMEM:-true}"
INSTALLONCREATE="${INSTALLONCREATE:-true}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST=/usr/local/share/claude-workspace

if ! command -v node >/dev/null 2>&1; then
  echo "claude-workspace feature: Node.js >= 22.13 is required. Use an image with Node 22 or add ghcr.io/devcontainers/features/node:1 (version 22)." >&2
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' || {
  echo "claude-workspace feature: Node.js >= 22.13 is required (found $(node --version))." >&2; exit 1; }
for t in git curl; do command -v "$t" >/dev/null 2>&1 || { echo "claude-workspace feature: '$t' is required in the image." >&2; exit 1; }; done

mkdir -p "$DEST"
if [ "$SOURCE" = "bundled" ]; then
  [ -f "$HERE/payload.tgz" ] || { echo "claude-workspace feature: payload.tgz is missing; build the feature with 'npm run build:feature'." >&2; exit 1; }
  rm -rf "$DEST/cli-root" && mkdir -p "$DEST/cli-root"
  tar -xzf "$HERE/payload.tgz" -C "$DEST/cli-root" --strip-components=1
  CLI="node $DEST/cli-root/cli/bin/claude-workspace.mjs"
else
  # Fetched when the command runs; npx caches it per user.
  CLI="npx -y $SOURCE"
fi

cat > /usr/local/bin/claude-workspace <<WRAP
#!/usr/bin/env bash
exec $CLI "\$@"
WRAP
chmod 755 /usr/local/bin/claude-workspace

# Options are baked into post-create.sh (the lifecycle command gets no feature options).
{
  echo '#!/usr/bin/env bash'
  printf 'MARKETPLACE=%q\nINSTALLCLAUDECODE=%q\nCLAUDECODEVERSION=%q\nCLAUDEMEM=%q\nINSTALLONCREATE=%q\n' \
    "$MARKETPLACE" "$INSTALLCLAUDECODE" "$CLAUDECODEVERSION" "$CLAUDEMEM" "$INSTALLONCREATE"
  cat "$HERE/post-create.sh"
} > "$DEST/post-create.sh"
chmod 755 "$DEST/post-create.sh"
if [ -f "$HERE/tested-claude-version" ]; then cp "$HERE/tested-claude-version" "$DEST/tested-claude-version"
else echo "claude-workspace feature: tested-claude-version missing (build with npm run build:feature); claudeCodeVersion=tested will install the latest" >&2; : > "$DEST/tested-claude-version"; fi
echo "claude-workspace feature: CLI installed ($SOURCE)."
