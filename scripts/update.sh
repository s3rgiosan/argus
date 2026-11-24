#!/bin/sh
# Updates Argus: pulls this clone, then runs install.sh, which copies the mods
# and builds the Argus layout again. Run it after a Herdr update too.
#
# Usage: sh scripts/update.sh [install.sh options]
# It stops when the clone has local changes, so a pull never mixes with them.

set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)

if [ -n "$(git -C "$repo" status --porcelain)" ]; then
  echo "update.sh: $repo has local changes; commit or stash them, then run it again" >&2
  exit 1
fi

git -C "$repo" pull --ff-only
exec sh "$repo/scripts/install.sh" "$@"
