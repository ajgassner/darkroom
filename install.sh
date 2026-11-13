#!/usr/bin/env bash
# Installs the darkroom command on macOS and Linux, with its own Node.js: nothing else needs to be installed.
#
#   curl -fsSL https://raw.githubusercontent.com/ajgassner/darkroom/main/install.sh | bash
#
# Run it again to update. Optional environment variables:
#   DARKROOM_DIR     where darkroom and its Node.js are installed (default: ~/.darkroom)
#   DARKROOM_HOME    where your data lives: .env, refs/, voices/, out/ (default: ~/darkroom)
#   DARKROOM_REF     branch or tag to install (default: main)
#   DARKROOM_SOURCE  URL of a source tarball, overrides DARKROOM_REF (e.g. file:// for testing)
set -euo pipefail

NODE_MAJOR=26
INSTALL_DIR="${DARKROOM_DIR:-$HOME/.darkroom}"
DATA_DIR="${DARKROOM_HOME:-$HOME/darkroom}"
REF="${DARKROOM_REF:-main}"
SOURCE="${DARKROOM_SOURCE:-https://github.com/ajgassner/darkroom/archive/$REF.tar.gz}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

for tool in curl tar; do
  command -v "$tool" >/dev/null || fail "$tool is required but not installed"
done

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported system $(uname -s); on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported processor $(uname -m)" ;;
esac

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$INSTALL_DIR" "$DATA_DIR"

# Node.js: latest release of the major version, verified against the official checksums
say "Downloading Node.js $NODE_MAJOR ($os-$arch)"
node_base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
curl -fsSL "$node_base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
node_file=$(grep -oE "node-v[0-9.]+-$os-$arch\.tar\.gz" "$tmp/SHASUMS256.txt" | head -n1)
[ -n "$node_file" ] || fail "no Node.js $NODE_MAJOR build for $os-$arch"
curl -fsSL "$node_base/$node_file" -o "$tmp/$node_file"
expected=$(grep " $node_file\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)
[ "$(sha256 "$tmp/$node_file")" = "$expected" ] || fail "checksum mismatch for $node_file"
rm -rf "$INSTALL_DIR/node"
mkdir -p "$INSTALL_DIR/node"
tar -xzf "$tmp/$node_file" -C "$INSTALL_DIR/node" --strip-components=1
export PATH="$INSTALL_DIR/node/bin:$PATH"

# darkroom itself (your data lives in DATA_DIR, so replacing the app keeps it)
say "Downloading darkroom (${DARKROOM_SOURCE:-$REF})"
curl -fsSL "$SOURCE" -o "$tmp/darkroom.tar.gz"
rm -rf "$INSTALL_DIR/app"
mkdir -p "$INSTALL_DIR/app"
tar -xzf "$tmp/darkroom.tar.gz" -C "$INSTALL_DIR/app" --strip-components=1

say "Installing dependencies (this takes a few minutes)"
cd "$INSTALL_DIR/app"
pnpm_version=$(node -p "require('./package.json').packageManager.split('@')[1]")
pnpm() { npm exec --yes --silent -- "pnpm@$pnpm_version" "$@"; }
pnpm install --frozen-lockfile --reporter=silent
say "Building the web UI"
build_log=$(pnpm build 2>&1) || {
  echo "$build_log" >&2
  fail "building the web UI failed"
}

# The command itself: runs the CLI with darkroom's own Node.js and your data folder
mkdir -p "$INSTALL_DIR/bin"
cat >"$INSTALL_DIR/bin/darkroom" <<EOF
#!/bin/sh
export DARKROOM_HOME="\${DARKROOM_HOME:-$DATA_DIR}"
exec "$INSTALL_DIR/node/bin/node" "$INSTALL_DIR/app/apps/cli/src/cli.ts" "\$@"
EOF
chmod +x "$INSTALL_DIR/bin/darkroom"

# Put the command on the PATH via the shell's startup file
path_line="export PATH=\"$INSTALL_DIR/bin:\$PATH\""
case "$(basename "${SHELL:-}")" in
  zsh) rc="$HOME/.zshrc" ;;
  bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
  *) rc="" ;;
esac
if [ -n "$rc" ]; then
  if ! grep -qsF "$INSTALL_DIR/bin" "$rc"; then
    printf '\n# darkroom\n%s\n' "$path_line" >>"$rc"
  fi
fi

# OpenRouter API key, asked once (reads from the terminal even when piped from curl)
env_file="$DATA_DIR/.env"
if ! grep -qs '^OPENROUTER_API_KEY=.' "$env_file" && [ -t 1 ] && [ -r /dev/tty ]; then
  printf '\nOpenRouter API key (https://openrouter.ai/settings/keys), or Enter to add it later: '
  read -r key </dev/tty || key=""
  if [ -n "$key" ]; then
    printf 'OPENROUTER_API_KEY=%s\n' "$key" >>"$env_file"
    chmod 600 "$env_file"
  fi
fi

echo
say "darkroom is installed"
echo "    app:  $INSTALL_DIR"
echo "    data: $DATA_DIR"
grep -qs '^OPENROUTER_API_KEY=.' "$env_file" || echo "    Add your key to $env_file: OPENROUTER_API_KEY=sk-or-v1-..."
echo
if [ -n "$rc" ]; then
  echo "Open a new terminal, then:"
else
  echo "Add this line to your shell's startup file, open a new terminal, then:"
  echo "    $path_line"
fi
echo "    darkroom start      web UI on http://localhost:5177"
echo "    darkroom --help     all commands"
