#!/bin/sh
# Asks Claude Code for plan usage through its get_usage control request and
# prints the reply line. Claude Code signs in by itself; this script reads no
# credentials. The profile comes from the inherited CLAUDE_CONFIG_DIR.
#
# Usage: sh usage.sh [claude-command]
# Exit:  0 reply printed, 1 no reply before the timeout, 127 claude not found.
# CLAUDE_USAGE_TIMEOUT sets the timeout in whole seconds (default 15).

claude=${1:-claude}
if ! command -v "$claude" >/dev/null 2>&1; then
  echo "usage.sh: claude not found: $claude" >&2
  exit 127
fi

timeout=${CLAUDE_USAGE_TIMEOUT:-15}
case $timeout in
  '' | *[!0-9]*) timeout=15 ;;
esac

tmp=${TMPDIR:-/tmp}
# Folders left by a run that was killed outright, where no cleanup could run.
# Only folders of the current user are removed.
find "$tmp" -maxdepth 1 -type d -name 'argus-claude-usage.*' -user "$(id -u)" -mmin +60 -exec rm -rf {} + 2>/dev/null

dir=$(mktemp -d "$tmp/argus-claude-usage.XXXXXX") || exit 1
pid=

cleanup() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null
    # Give claude a second to stop, then force it, so a claude that ignores
    # TERM cannot keep this script waiting.
    i=0
    while [ "$i" -lt 5 ] && kill -0 "$pid" 2>/dev/null; do
      sleep 0.2
      i=$((i + 1))
    done
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  fi
  rm -rf "$dir"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

mkfifo "$dir/in" || exit 1

"$claude" -p --safe-mode --no-session-persistence \
  --input-format stream-json --output-format stream-json --verbose \
  <"$dir/in" >"$dir/out" 2>/dev/null &
pid=$!

# Keep the pipe open so Claude Code waits for more input after the request.
exec 3>"$dir/in"
# A claude that exits at once closes the pipe. Ignore SIGPIPE here (claude
# already started with the default), so the failed write cannot kill this
# script and the checks below end with exit 1.
trap '' PIPE
printf '%s\n' '{"type":"control_request","request_id":"argus-claude-usage","request":{"subtype":"get_usage","skip_behaviors":true}}' >&3 2>/dev/null || :

found=
# Check twice a second.
ticks=$((timeout * 2))
i=0
while [ "$i" -lt "$ticks" ]; do
  if grep -q '"control_response"' "$dir/out" 2>/dev/null; then
    found=1
    break
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.5
  i=$((i + 1))
done

# Close the input so Claude Code can finish writing and exit, then give it a
# moment before cleanup stops it.
exec 3>&-
if [ -n "$found" ]; then
  i=0
  while [ "$i" -lt 5 ] && kill -0 "$pid" 2>/dev/null; do
    sleep 0.2
    i=$((i + 1))
  done
fi

line=$(grep -m1 '"control_response"' "$dir/out" 2>/dev/null)
[ -n "$line" ] || exit 1
printf '%s\n' "$line"
