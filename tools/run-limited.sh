#!/bin/sh
# run-limited.sh - run one command with a hard time limit and low priority.
#   tools/run-limited.sh <seconds> <command> [args...]
# Marco rule 2026-10-25 (Ubuntu VM): every test/build/script run gets a hard
# limit, its own process group/session, nice 19 and idle I/O, so a hung run can
# never spin for hours. `timeout` only signals its direct child, so after the
# command ended (or hit the limit: exit 124/137) the whole session is swept with
# TERM then KILL - nothing is left behind. Exit code = the command's.
# Missing nice/ionice/setsid are skipped, never fatal; `timeout` is required.
set -eu
if [ "$#" -lt 2 ]; then echo "usage: run-limited.sh <seconds> <command> [args...]" >&2; exit 2; fi
secs=$1; shift
case "$secs" in ''|*[!0-9]*|0) echo "run-limited: seconds must be a positive integer" >&2; exit 2 ;; esac
command -v timeout >/dev/null 2>&1 || { echo "run-limited: 'timeout' not found" >&2; exit 2; }
pre=""
command -v nice >/dev/null 2>&1 && pre="nice -n 19"
command -v ionice >/dev/null 2>&1 && pre="$pre ionice -c3"
# `timeout` moves itself into its own process group, so sweep by session (setsid).
# shellcheck disable=SC2016 # single quotes on purpose: expanded by the inner sh
inner='secs=$1; shift
rc=0; timeout -k 5 -s KILL "$secs" "$@" || rc=$?
trap "" TERM
sweep() { for p in $(pgrep -s "$$" 2>/dev/null || true); do [ "$p" = "$$" ] || kill "-$1" "$p" 2>/dev/null || true; done; }
sweep TERM
sleep 1
sweep KILL
exit "$rc"'
if command -v setsid >/dev/null 2>&1; then
  # shellcheck disable=SC2086 # $pre is a deliberate word list
  exec $pre setsid -w sh -c "$inner" run-limited "$secs" "$@"
fi
# shellcheck disable=SC2086
exec $pre timeout -k 5 -s KILL "$secs" "$@"
