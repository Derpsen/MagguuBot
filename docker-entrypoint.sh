#!/bin/sh
# Unraid nobody/users is 99:100. Live SQLite files are root-owned, so this
# chowns the mounted data dirs and then drops. Set PUID=0 to stay root.
set -eu

PUID="${PUID:-99}"
PGID="${PGID:-100}"

if [ "$(id -u)" != "0" ] || [ "$PUID" = "0" ]; then
  exec "$@"
fi

for dir in /app/data /app/uploads; do
  if [ -d "$dir" ]; then
    chown -R "$PUID:$PGID" "$dir"
  fi
done

if command -v gosu >/dev/null 2>&1; then
  exec gosu "$PUID:$PGID" "$@"
fi
exec su-exec "$PUID:$PGID" "$@"
