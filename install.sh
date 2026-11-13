#!/usr/bin/env bash
# Installs the darkroom command on macOS and Linux, with its own Node.js: nothing else needs to be installed.
#
#   curl -fsSL https://raw.githubusercontent.com/ajgassner/darkroom/main/install.sh | bash
#
# Run it again (or "darkroom update") to update. Optional environment variables:
#   DARKROOM_DIR     where darkroom and its Node.js are installed (default: ~/.darkroom)
#   DARKROOM_HOME    where your data lives: .env, refs/, voices/, out/ (default: ~/darkroom, or the folder
#                    of the existing installation)
#   DARKROOM_REF     branch or tag to install (default: the latest release, or main before the first one)
#   DARKROOM_SOURCE  URL of a source tarball, overrides DARKROOM_REF (e.g. file:// for testing)
#
# Everything runs in main(), called on the last line: if the download breaks off, nothing runs.
set -euo pipefail

NODE_MAJOR=26
REPO=https://github.com/ajgassner/darkroom
# Marker in node/ and app/: the folder holds a complete, built version that can be restored
COMPLETE=.darkroom-complete

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
fail() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# Absolute paths: the command and the shell startup file must work from any folder
absolute() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }

# Absolute path without . and .., with symlinks resolved as far as the folders exist (for comparisons)
canonical() {
  local path=$1 rest="" part
  while [ ! -d "$path" ]; do
    rest="$(basename "$path")/$rest"
    path=$(dirname "$path")
  done
  path=$(cd -P "$path" && pwd -P)
  while [ -n "$rest" ]; do
    part=${rest%%/*}
    rest=${rest#*/}
    case "$part" in
      . | '') ;;
      ..) path=$(dirname "$path") ;;
      *) path="${path%/}/$part" ;;
    esac
  done
  # macOS folders are case-insensitive by default
  if [ "$os" = darwin ]; then printf '%s' "$path" | tr '[:upper:]' '[:lower:]'; else printf '%s' "$path"; fi
}

# Whether canonical path $1 is $2 or inside it
inside() {
  case "$1/" in "${2%/}/"*) return 0 ;; esac
  return 1
}

# Whether the folder is empty or holds only what the installer creates (an interrupted first install)
looks_like_install() {
  local entry
  [ -f "$1/bin/darkroom" ] && return 0
  for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    case "${entry##*/}" in
      node | app | bin | staging | cache | node.old | app.old | *.trash | .DS_Store) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

# Updates replace the install folder and uninstall removes it: it must not hold your data or anything else
check_folders() {
  local install data home problem=""
  install=$(canonical "$INSTALL_DIR")
  data=$(canonical "$DATA_DIR")
  home=$(canonical "$HOME")
  # The most specific problem first: the home folder (or /) also contains the data folder, and a data folder
  # used as install folder also holds files that darkroom did not create
  if inside "$home" "$install"; then
    fail "$INSTALL_DIR is your home folder or contains it; set DARKROOM_DIR to a folder of its own (default: ~/.darkroom)."
  fi
  if [ "$install" = "$data" ]; then
    problem="the install folder and the data folder are the same ($INSTALL_DIR)"
  elif inside "$data" "$install"; then
    problem="the data folder $DATA_DIR is inside the install folder $INSTALL_DIR"
  elif inside "$install" "$data"; then
    problem="the install folder $INSTALL_DIR is inside the data folder $DATA_DIR"
  fi
  if [ -n "$problem" ]; then
    if [ -f "$INSTALL_DIR/bin/darkroom" ]; then
      problem="$problem. Don't run \"darkroom uninstall\" of the existing installation: older versions delete the whole install folder, with your data in it"
    fi
    fail "$problem. darkroom replaces its install folder on updates and removes it on uninstall, so set DARKROOM_DIR and DARKROOM_HOME to two separate folders (defaults: ~/.darkroom and ~/darkroom)."
  fi
  if [ -d "$INSTALL_DIR" ] && ! looks_like_install "$INSTALL_DIR"; then
    fail "$INSTALL_DIR already contains files that darkroom did not create; set DARKROOM_DIR to a new or empty folder (default: ~/.darkroom)."
  fi
}

# A value stored single-quoted in the existing darkroom command
wrapper_value() {
  sed -n "s/^$1='\(.*\)'\$/\1/p" "$INSTALL_DIR/bin/darkroom" | head -n1 | sed "s/'\\\\''/'/g"
}

# The latest release from the redirect of releases/latest (unlike the GitHub API it has no rate limit);
# main only as long as there is no release yet
latest_release() {
  local url
  url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$REPO/releases/latest") ||
    fail "could not reach GitHub to look up the latest darkroom release; check your internet connection, or set DARKROOM_REF to a version"
  case "$url" in
    */releases/tag/?*) printf '%s' "${url##*/releases/tag/}" ;;
    */releases | */releases/) printf main ;;
    *) fail "unexpected answer from GitHub when looking up the latest release: $url" ;;
  esac
}

# Shell startup file that puts the command on the PATH
shell_rc() {
  local file
  case "$(basename "${SHELL:-}")" in
    zsh) printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [ "$os" != darwin ]; then
        printf '%s' "$HOME/.bashrc"
        return
      fi
      # Terminals on macOS start login shells, which read only the first of these files that exists
      for file in .bash_profile .bash_login .profile; do
        if [ -f "$HOME/$file" ]; then
          printf '%s' "$HOME/$file"
          return
        fi
      done
      printf '%s' "$HOME/.bash_profile"
      ;;
  esac
}

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# An update keeps the previous node/ and app/ as node.old/ and app.old/ until the new ones are built,
# and puts them back if anything fails, so a failed update leaves the installed darkroom working.
# Building happens in place, because installed packages contain absolute paths (pnpm bin shims, junctions).
# Folders are renamed to *.trash before they are deleted, so an interrupted deletion never leaves a
# half-deleted folder under a name that counts: *.trash is deleted on the next run.
to_trash() {
  if [ -e "$1" ] || [ -L "$1" ]; then mv "$1" "$1.$(date +%s)$$.trash"; fi
}
empty_trash() {
  rm -rf "${INSTALL_DIR:?}"/*.trash 2>/dev/null || true
}
restore() {
  local part
  for part in "$@"; do
    to_trash "$INSTALL_DIR/$part"
    if [ -e "$INSTALL_DIR/$part.old" ]; then mv "$INSTALL_DIR/$part.old" "$INSTALL_DIR/$part"; fi
  done
}
cleanup() {
  status=$?
  # Finish restoring even if Ctrl+C is pressed again
  trap '' INT TERM HUP
  # shellcheck disable=SC2086 # word splitting intended: the list of swapped parts
  if [ "$status" -ne 0 ] && [ -n "$swapped" ]; then
    say "Installation failed, restoring the previous version"
    restore $swapped || true
  fi
  trap - INT TERM HUP
  rm -rf "$tmp" "$staging" || true
  empty_trash
}

# After an update that was killed halfway (kill -9, power loss): a backup is put back only if it is complete
# and the new version isn't; otherwise it is dropped
recover() {
  local part
  for part in node app; do
    if [ -e "$INSTALL_DIR/$part.old" ]; then
      trusted=""
      if [ -f "$INSTALL_DIR/$part.old/$COMPLETE" ] && [ ! -f "$INSTALL_DIR/$part/$COMPLETE" ]; then
        say "Restoring the previous $part/ (an earlier update did not finish)"
        restore "$part"
      else
        to_trash "$INSTALL_DIR/$part.old"
      fi
    fi
  done
  empty_trash
}

main() {
  INSTALL_DIR=$(absolute "${DARKROOM_DIR:-$HOME/.darkroom}")
  DATA_DIR="${DARKROOM_HOME:-}"
  # An existing installation keeps its data folder (stored single-quoted in the darkroom command)
  if [ -z "$DATA_DIR" ] && [ -f "$INSTALL_DIR/bin/darkroom" ]; then DATA_DIR=$(wrapper_value data_dir); fi
  DATA_DIR=$(absolute "${DATA_DIR:-$HOME/darkroom}")

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
  check_folders

  REF="${DARKROOM_REF:-}"
  if [ -z "$REF" ] && [ -z "${DARKROOM_SOURCE:-}" ]; then REF=$(latest_release); fi
  SOURCE="${DARKROOM_SOURCE:-$REPO/archive/$REF.tar.gz}"

  # An update keeps the startup file the PATH line went into
  rc=""
  if [ -f "$INSTALL_DIR/bin/darkroom" ]; then
    rc=$(wrapper_value rc)
    if [ -n "$rc" ] && ! grep -qsF "$INSTALL_DIR/bin" "$rc"; then rc=""; fi
  fi
  [ -n "$rc" ] || rc=$(shell_rc)

  # The installed version can be restored if this update fails. Installations from before the completion
  # markers count as complete unless an earlier update was interrupted.
  trusted=""
  if [ -f "$INSTALL_DIR/bin/darkroom" ]; then trusted=yes; fi
  swapped=""
  tmp=$(mktemp -d)
  staging="$INSTALL_DIR/staging"
  trap cleanup EXIT
  trap 'exit 130' INT TERM HUP
  mkdir -p "$INSTALL_DIR" "$DATA_DIR"
  recover
  rm -rf "$staging"
  mkdir -p "$staging/node" "$staging/app"

  # Node.js: latest release of the major version, verified against the official checksums
  say "Downloading Node.js $NODE_MAJOR ($os-$arch)"
  node_base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  curl -fsSL "$node_base/SHASUMS256.txt" >"$tmp/SHASUMS256.txt"
  node_file=$(grep -oE "node-v[0-9.]+-$os-$arch\.tar\.gz" "$tmp/SHASUMS256.txt" | head -n1)
  [ -n "$node_file" ] || fail "no Node.js $NODE_MAJOR build for $os-$arch"
  curl -fsSL "$node_base/$node_file" >"$tmp/$node_file"
  expected=$(grep " $node_file\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)
  [ "$(sha256 "$tmp/$node_file")" = "$expected" ] || fail "checksum mismatch for $node_file"
  tar -xzf "$tmp/$node_file" -C "$staging/node" --strip-components=1

  # darkroom itself (your data lives in DATA_DIR, so replacing the app keeps it).
  # Downloads go through the shell, not curl -o: a snap-packaged curl (Ubuntu) cannot write to /tmp itself.
  say "Downloading darkroom (${DARKROOM_SOURCE:-$REF})"
  curl -fsSL "$SOURCE" >"$tmp/darkroom.tar.gz"
  tar -xzf "$tmp/darkroom.tar.gz" -C "$staging/app" --strip-components=1
  [ -f "$staging/app/package.json" ] || fail "the darkroom download is incomplete"

  # A running darkroom keeps working from files that are about to be replaced: it needs a restart afterwards
  running=""
  procs=$(ps -A -ww -o command= 2>/dev/null) || procs=""
  case "$procs" in *"$INSTALL_DIR/node/bin/node "*) running=yes ;; esac

  # Everything is downloaded: swap in the new version, keeping the previous one until it is built
  for part in node app; do
    if [ -e "$INSTALL_DIR/$part" ]; then
      if [ -n "$trusted" ]; then touch "$INSTALL_DIR/$part/$COMPLETE"; fi
      mv "$INSTALL_DIR/$part" "$INSTALL_DIR/$part.old"
    fi
    swapped="$swapped $part"
    mv "$staging/$part" "$INSTALL_DIR/$part"
  done
  export PATH="$INSTALL_DIR/node/bin:$PATH"
  # pnpm's store and the npm and pnpm caches stay in the install folder, so uninstall removes them; the store
  # is on the same volume as app/, so pnpm can hard-link packages from it
  export pnpm_config_store_dir="$INSTALL_DIR/cache/pnpm-store" pnpm_config_cache_dir="$INSTALL_DIR/cache/pnpm" \
    pnpm_config_state_dir="$INSTALL_DIR/cache/pnpm-state" npm_config_cache="$INSTALL_DIR/cache/npm" \
    npm_config_update_notifier=false \
    npm_config_onnxruntime_node_install_cuda=skip # background removal runs on the CPU: skip the 171 MB CUDA download

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

  # The command itself: runs the CLI with darkroom's own Node.js and your data folder.
  # "darkroom uninstall" is handled here, since it removes the app the CLI runs from. It removes only what
  # the installer created, and the install folder itself only if nothing else is left in it.
  path_line="export PATH=\"$INSTALL_DIR/bin:\$PATH\""
  quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
  mkdir -p "$INSTALL_DIR/bin"
  {
    echo '#!/bin/sh'
    echo "install_dir=$(quote "$INSTALL_DIR")"
    echo "data_dir=$(quote "$DATA_DIR")"
    echo "rc=$(quote "$rc")"
    echo "path_line=$(quote "$path_line")"
    cat <<'WRAPPER'
# Only "darkroom update" and "darkroom uninstall [--yes]": anything else (like --help) goes to the CLI
if [ $# -eq 1 ] && [ "$1" = update ]; then
  # exec: the installer rewrites this file, so no shell may keep reading it
  export DARKROOM_DIR="$install_dir" DARKROOM_HOME="$data_dir"
  exec /bin/sh -c 'curl -fsSL https://raw.githubusercontent.com/ajgassner/darkroom/main/install.sh | bash'
fi
if [ "$1" = uninstall ] && { [ $# -eq 1 ] || { [ $# -eq 2 ] && { [ "$2" = --yes ] || [ "$2" = -y ]; }; }; }; then
  if [ $# -eq 1 ] && [ -t 0 ]; then
    printf 'Remove darkroom from %s? Your data in %s stays. [y/N] ' "$install_dir" "$data_dir"
    read -r answer || answer=""
    case "$answer" in
      [yY] | [yY][eE][sS]) ;;
      *)
        echo "Cancelled."
        exit 1
        ;;
    esac
  fi
  if [ -n "$rc" ] && [ -f "$rc" ]; then
    # Rewrite in place, so a symlinked startup file stays a symlink
    # grep exits 1 when no line is left, 2 on errors: then the file must stay as it is
    kept=$(grep -vxF -e '# darkroom' -e "$path_line" "$rc")
    if [ $? -le 1 ]; then
      # No line left (the installer created the file): empty it instead of leaving a lone newline
      if [ -n "$kept" ]; then printf '%s\n' "$kept" >"$rc"; else : >"$rc"; fi
    else
      echo "Could not update $rc; remove the darkroom lines from it yourself." >&2
    fi
  fi
  for part in node app staging cache node.old app.old bin; do
    case "$data_dir/" in
      "$install_dir/$part/"*) echo "Kept $install_dir/$part: your data folder is in there." >&2 ;;
      *) rm -rf "${install_dir:?}/$part" ;;
    esac
  done
  rm -rf "$install_dir"/*.trash "$install_dir/.DS_Store"
  rmdir "$install_dir" 2>/dev/null || echo "Kept $install_dir: it contains files that darkroom did not create."
  echo "darkroom is uninstalled. Your data is still in $data_dir; delete that folder if you don't need it anymore."
  exit 0
fi
export DARKROOM_HOME="${DARKROOM_HOME:-$data_dir}"
exec "$install_dir/node/bin/node" "$install_dir/app/apps/cli/src/cli.ts" "$@"
WRAPPER
  } >"$INSTALL_DIR/bin/darkroom"
  chmod +x "$INSTALL_DIR/bin/darkroom"

  # The new version works: mark it complete and drop the previous one (from here on nothing is rolled back)
  touch "$INSTALL_DIR/node/$COMPLETE" "$INSTALL_DIR/app/$COMPLETE"
  swapped=""
  for part in node app; do to_trash "$INSTALL_DIR/$part.old" || true; done
  empty_trash

  if [ -n "$rc" ] && ! grep -qsF "$INSTALL_DIR/bin" "$rc"; then
    printf '\n# darkroom\n%s\n' "$path_line" >>"$rc"
  fi

  # OpenRouter API key, asked once (reads from the terminal even when piped from curl)
  env_file="$DATA_DIR/.env"
  if ! grep -qs '^OPENROUTER_API_KEY=.' "$env_file" && [ -t 1 ] && [ -r /dev/tty ]; then
    printf '\nOpenRouter API key (https://openrouter.ai/settings/keys), or Enter to add it later: '
    # -s: the key is not shown while typing
    read -rs key </dev/tty || key=""
    echo
    if [ -n "$key" ]; then
      (
        umask 077
        # Start on a new line if the file doesn't end with one
        if [ -s "$env_file" ] && [ -n "$(tail -c1 "$env_file")" ]; then echo >>"$env_file"; fi
        printf 'OPENROUTER_API_KEY=%s\n' "$key" >>"$env_file"
      )
      chmod 600 "$env_file"
    fi
    key=""
  fi

  echo
  say "darkroom is installed"
  echo "    app:  $INSTALL_DIR"
  echo "    data: $DATA_DIR"
  grep -qs '^OPENROUTER_API_KEY=.' "$env_file" || echo "    Add your key to $env_file: OPENROUTER_API_KEY=sk-or-v1-..."
  if [ -n "$running" ]; then
    echo
    echo "darkroom is still running the previous version: restart it (Ctrl+C, then darkroom start) to use the new one."
  fi
  echo
  if [ -n "$rc" ]; then
    echo "Open a new terminal, then:"
  else
    echo "Add this line to your shell's startup file, open a new terminal, then:"
    echo "    $path_line"
  fi
  echo "    darkroom start      web UI on http://localhost:5177"
  echo "    darkroom --help     all commands"
  echo "    darkroom update     update to the latest release (keeps your data)"
  echo "    darkroom uninstall  remove darkroom (keeps your data)"
}

main "$@"
