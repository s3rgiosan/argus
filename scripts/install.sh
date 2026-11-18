#!/bin/sh
# Installs this repo's mods into the Herdr app: each mods/<name> becomes
# ~/.config/herdr-app/mods/<name> (or $HERDR_APP_HOME/mods/<name>).
#
# Usage: sh scripts/install.sh [--link] [--force] [mod ...]
#   --link   make a symlink to this repo instead of a copy. Herdr app 0.1.16
#            does not load a symlinked mod folder, so copy is the default.
#   --force  replace an existing folder that this script did not make
#   mod      names under mods/ (default: all)

set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
target="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"
link=
force=

while [ $# -gt 0 ]; do
  case $1 in
    --link) link=1 ;;
    --force) force=1 ;;
    -*) echo "install.sh: unknown option: $1" >&2; exit 2 ;;
    *) break ;;
  esac
  shift
done

if [ $# -eq 0 ]; then
  set --
  for dir in "$repo"/mods/*/; do
    set -- "$@" "$(basename "$dir")"
  done
fi

mkdir -p "$target"

for name in "$@"; do
  # Tab completion adds a trailing slash; with it, a test or rm on the
  # destination follows a symlink into this repo.
  while [ "${name%/}" != "$name" ]; do
    name=${name%/}
  done
  case $name in
    '' | . | .. | */*)
      echo "install.sh: invalid mod name: $name" >&2
      exit 1
      ;;
  esac

  src="$repo/mods/$name"
  dest="$target/$name"
  if [ ! -f "$src/main.js" ]; then
    echo "install.sh: no mod named $name" >&2
    exit 1
  fi

  if [ -L "$dest" ]; then
    # A link into this repo is one --link made; any other link needs --force.
    case $(readlink "$dest") in
      "$repo"/*) ;;
      *)
        if [ -z "$force" ]; then
          echo "install.sh: $dest is a link to somewhere else; use --force to replace it" >&2
          exit 1
        fi
        ;;
    esac
    rm "$dest"
  elif [ -e "$dest" ]; then
    if [ -z "$force" ] && [ ! -f "$dest/.installed-from-argus" ]; then
      echo "install.sh: $dest exists and was not installed by this script; use --force to replace it" >&2
      exit 1
    fi
    rm -rf "$dest"
  fi

  if [ -z "$link" ]; then
    mkdir -p "$dest"
    # The marker goes first, so a copy that fails halfway can be run again.
    : > "$dest/.installed-from-argus"
    (cd "$src" && find . -type f ! -name gpui-kit.d.ts ! -name jsconfig.json ! -name .DS_Store) | while IFS= read -r file; do
      mkdir -p "$dest/$(dirname "$file")"
      cp -p "$src/$file" "$dest/$file"
    done
    echo "copied $name -> $dest"
  else
    ln -s "$src" "$dest"
    echo "linked $name -> $dest"
  fi
done
