#!/bin/sh
# Removes Argus from the Herdr app: every mod folder install.sh made, every copy
# of a Herdr mod and every layout that build-layout.mjs wrote. When an Argus
# layout shows, Herdr switches to its main layout first. argus.json and the
# mods' saved state stay.
#
# Usage: sh scripts/uninstall.sh

set -eu

app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
MARKER='"generated_by": *"argus"'

for dir in "$app"/mods/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  path="$app/mods/$name"
  if [ -L "$path" ]; then
    continue
  fi
  if [ -f "$path/.installed-from-argus" ] || grep -q "$MARKER" "$path/mod.json" 2>/dev/null; then
    rm -rf "${path:?}"
    echo "removed mods/$name"
  fi
done

for file in "$app"/layouts/*.json; do
  [ -f "$file" ] || continue
  grep -q "$MARKER" "$file" || continue
  name=$(basename "$file" .json)
  # A layout that shows cannot go away under Herdr's feet.
  if command -v herdr-app >/dev/null 2>&1 && herdr-app status 2>/dev/null | grep -q "\"layout\": *\"$name\""; then
    herdr-app do layout.switch '{"name":"main"}' >/dev/null || true
  fi
  rm -f "$file" "$app/layouts/$name.svg"
  echo "removed layouts/$name.json"
done

echo "argus.json stays in $app; delete it by hand if you no longer want it."
