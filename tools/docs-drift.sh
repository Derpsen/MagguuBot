#!/usr/bin/env bash
# docs-drift.sh - generic docs drift check for Magguu repos. Copy 1:1; all
# repo-specific knowledge lives in the rules file. Run from the repo root.
#
#   tools/docs-drift.sh [rules-file]      (default: .github/docs-drift-rules.txt)
#
# Exit 0 = no hits, 1 = hits (printed as file:line: reason), 2 = usage/config error.
#
# Rules file format (UTF-8, one entry per line):
#   # comment                         ignored, as are blank lines
#   regex<TAB>reason[<TAB>allow-regex[<TAB>file-regex]]
#                                     a hit is a line matching regex (ERE,
#                                     case-sensitive) unless it also matches
#                                     allow-regex or a global @allow.
#                                     allow-regex "!" = no allow at all (also
#                                     ignores @allow); "" or "-" = none.
#                                     file-regex limits the rule to matching
#                                     paths, e.g. ^AGENTS\.md$
#   @files <glob> [<glob> ...]        files to scan (bash globstar; repeatable).
#                                     Default: AGENTS.md MEMORY.md README*.md
#                                     CLAUDE.md .github/copilot-instructions.md
#                                     .cursor/rules/** .grok/**
#   @allow <regex>                    global allow (e.g. dated history lines)
#   @ignorecase                       match rules case-insensitively
#   @health-url <url>                 must answer HTTP 200 (repeatable; curl).
#                                     A failure is reported as a hit.
set -uo pipefail
shopt -s globstar nullglob

rules=${1:-.github/docs-drift-rules.txt}
[ -f "$rules" ] || { echo "docs-drift: rules file '$rules' not found" >&2; exit 2; }

TAB=$'\t'
files_globs=() allows=() rx=() reason=() allow=() scope=() health=()
icase=0

while IFS= read -r line || [ -n "$line" ]; do
  line=${line%$'\r'}
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in
    '@files '*) read -r -a g <<<"${line#@files }"; files_globs+=("${g[@]}"); continue ;;
    '@allow '*) allows+=("${line#@allow }"); continue ;;
    '@ignorecase') icase=1; continue ;;
    '@health-url '*) health+=("${line#@health-url }"); continue ;;
    '@'*) echo "docs-drift: unknown directive: $line" >&2; exit 2 ;;
  esac
  case "$line" in *"$TAB"*) ;; *) echo "docs-drift: rule without TAB reason: $line" >&2; exit 2 ;; esac
  IFS="$TAB" read -r r why al sc <<<"$line"
  [ "${al:-}" = - ] && al=''
  rx+=("$r"); reason+=("$why"); allow+=("${al:-}"); scope+=("${sc:-}")
done < "$rules"

[ ${#files_globs[@]} -gt 0 ] || files_globs=(AGENTS.md MEMORY.md 'README*.md' CLAUDE.md .github/copilot-instructions.md '.cursor/rules/**' '.grok/**')

files=()
for g in "${files_globs[@]}"; do
  for f in $g; do [ -f "$f" ] && files+=("$f"); done
done

gflag=(-E); [ "$icase" = 1 ] && gflag=(-E -i)
global_allow=''
for a in "${allows[@]}"; do global_allow+="${global_allow:+|}($a)"; done

hits=0
report() { printf '%s:%s: %s\n' "$1" "$2" "$3"; hits=$((hits + 1)); }

for f in "${files[@]}"; do
  for i in "${!rx[@]}"; do
    if [ -n "${scope[$i]}" ] && ! printf '%s\n' "$f" | grep -qE -- "${scope[$i]}"; then continue; fi
    while IFS= read -r m; do
      ln=${m%%:*}; text=${m#*:}
      if [ "${allow[$i]}" = '!' ]; then report "$f" "$ln" "${reason[$i]}"; continue; fi
      if [ -n "${allow[$i]}" ] && printf '%s\n' "$text" | grep -q "${gflag[@]}" -- "${allow[$i]}"; then continue; fi
      if [ -n "$global_allow" ] && printf '%s\n' "$text" | grep -q "${gflag[@]}" -- "$global_allow"; then continue; fi
      report "$f" "$ln" "${reason[$i]}"
    done < <(grep -n "${gflag[@]}" -- "${rx[$i]}" "$f" 2>/dev/null || true)
  done
done

for url in "${health[@]}"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -A 'Mozilla/5.0 (X11; Linux x86_64) docs-drift' "$url" 2>/dev/null) || code=000
  [ "$code" = 200 ] || report "$url" 0 "health URL returned HTTP $code (expected 200)"
done

[ "$hits" -eq 0 ] && echo "docs-drift: OK (${#files[@]} files, ${#rx[@]} rules)"
[ "$hits" -eq 0 ]
