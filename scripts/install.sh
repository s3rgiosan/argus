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

# Copies the files of a mod folder into a new folder. A failing find fails the copy.
copy_mod() {
  list=$(mktemp "${TMPDIR:-/tmp}/argus-files.XXXXXX") || return 1
  if ! (cd "$1" && find . -type f ! -name gpui-kit.d.ts ! -name jsconfig.json ! -name .DS_Store) > "$list"; then
    rm -f "$list"
    return 1
  fi
  while IFS= read -r file; do
    mkdir -p "$2/$(dirname "$file")" && cp -p "$1/$file" "$2/$file" || { rm -f "$list"; return 1; }
  done < "$list"
  rm -f "$list"
}

# Moves the folder or link at $dest that the checks above allowed to go to $aside.
set_old_aside() {
  [ -n "$old" ] || return 0
  mv "$dest" "$aside"
}

# Deletes the old copy that set_old_aside moved.
drop_old() {
  case $old in
    link) rm "$aside" ;;
    dir) rm -rf "$aside" ;;
  esac
}

# Removes the folder or link at $dest that the checks above allowed to go.
remove_old() {
  case $old in
    link) rm "$dest" ;;
    dir) rm -rf "$dest" ;;
  esac
}

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

  old=
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
    old=link
  elif [ -e "$dest" ]; then
    if [ -z "$force" ] && [ ! -f "$dest/.installed-from-argus" ]; then
      echo "install.sh: $dest exists and was not installed by this script; use --force to replace it" >&2
      exit 1
    fi
    old=dir
  fi

  if [ -z "$link" ]; then
    # Copy into a folder beside mods/ first, so Herdr never loads a half copy.
    # The old folder stays until the copy is whole.
    new=$(mktemp -d "${target%/*}/.argus-install.XXXXXX") || exit 1
    trap 'rm -rf "$new"' EXIT
    : > "$new/.installed-from-argus"
    if ! copy_mod "$src" "$new"; then
      echo "install.sh: could not copy $name; $dest is unchanged" >&2
      exit 1
    fi
    # mktemp makes the folder 0700; give it the mode that mkdir would.
    chmod "$(printf '%o' $((0777 & ~0$(umask))))" "$new"
    aside="$dest.argus-old.$$"
    if ! set_old_aside; then
      echo "install.sh: could not move $dest aside; it is unchanged" >&2
      exit 1
    fi
    if ! mv "$new" "$dest"; then
      if [ -n "$old" ] && ! mv "$aside" "$dest"; then
        echo "install.sh: could not install $name, and the old copy is at $aside" >&2
        trap - EXIT
        exit 1
      fi
      echo "install.sh: could not install $name; $dest is unchanged" >&2
      exit 1
    fi
    drop_old
    trap - EXIT
    echo "copied $name -> $dest"
  else
    remove_old
    ln -s "$src" "$dest"
    echo "linked $name -> $dest"
  fi
done
