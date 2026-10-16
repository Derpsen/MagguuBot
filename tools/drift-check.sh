#!/usr/bin/env bash
# drift-check.sh - Magguu product-drift guard. Run from repo root.
# Exit 0 = clean, 1 = drift found (each finding printed as file:line: message).
# Each check silently skips when it does not apply to the current repo.
set -uo pipefail

MIN_EUI="9.0.6"
# Node 26 live for MagguuBot since 2026-10-16 (Marco approved); Website keeps >=24.17 in its own copy.
NODE_ENGINE="${NODE_ENGINE:->=26}"
fail=0
report() { printf '%s:%s: %s\n' "$1" "$2" "$3"; fail=1; }

# Tracked files when in git, else a plain find (portable fallback).
list_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files
  else
    find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | sed 's|^\./||'
  fi
}

# 1) Banned addon names (case-insensitive, whole word); history files excluded.
banned='(WIM|WindTools|KeystoneLoot)'
while IFS= read -r f; do
  case "$f" in
    # AGENTS.md (the ban rules themselves) and tests/ (negative assertions) are excluded too.
    *CHANGELOG*|*MEMORY*|*AGENTS.md|tests/*|*Changelog.lua|drift-check.sh|*/drift-check.sh) continue ;;
    *package-lock.json|*.png|*.jpg|*.tga|*.blp|*.ttf|*.otf|*.ogg|*.mp3|*.zip) continue ;;
  esac
  [ -f "$f" ] || continue
  while IFS=: read -r ln _; do
    report "$f" "$ln" "banned name (WIM/WindTools/KeystoneLoot)"
  done < <(grep -inwE "$banned" -- "$f" 2>/dev/null || true)
done < <(list_files)

# 2) EllesmereUI min version in TOCs (only TOCs that reference EllesmereUI).
ver_lt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]; }
while IFS= read -r toc; do
  grep -q 'EllesmereUI' -- "$toc" || continue
  if grep -qiE '^## *X-EllesmereUI-Min-Version:' -- "$toc"; then
    while IFS=: read -r ln line; do
      v=$(printf '%s' "$line" | grep -oE '[0-9]+(\.[0-9]+)+' | head -n1)
      if [ -z "$v" ] || ver_lt "$v" "$MIN_EUI"; then
        report "$toc" "$ln" "EllesmereUI min version '${v:-?}' < $MIN_EUI"
      fi
    done < <(grep -niE '^## *X-EllesmereUI-Min-Version:' -- "$toc")
  elif [ "$(basename "$toc")" = "MagguuUI.toc" ] && grep -qiE '^## *(RequiredDeps|Dependencies):.*EllesmereUI' -- "$toc"; then
    # Sibling addons (MagguuUI_EUI etc.) inherit the gate via their MagguuUI dependency.
    ln=$(grep -niE '^## *(RequiredDeps|Dependencies):.*EllesmereUI' -- "$toc" | head -n1 | cut -d: -f1)
    report "$toc" "$ln" "depends on EllesmereUI but has no X-EllesmereUI-Min-Version (need >= $MIN_EUI)"
  fi
done < <(list_files | grep -E '\.toc$' | grep -E '(^|/)MagguuUI[^/]*\.toc$|^MagguuUI')

# 3) Containers run as uid 99: USER 99[:gid], or entrypoint drop via PUID=99.
if [ -f Dockerfile ]; then
  users=$(grep -nE '^[[:space:]]*USER[[:space:]]+' Dockerfile || true)
  if [ -n "$users" ]; then
    last=$(printf '%s\n' "$users" | tail -n1)
    ln=${last%%:*}; u=$(printf '%s' "${last#*:}" | awk '{print $2}')
    case "$u" in 99|99:*) ;; *) report Dockerfile "$ln" "final USER is '$u', expected 99" ;; esac
  elif ! grep -qE 'PUID=99([^0-9]|$)' Dockerfile; then
    report Dockerfile 1 "no USER 99 and no PUID=99 privilege drop"
  fi
fi

# 4) engines.node must equal $NODE_ENGINE (trailing .0 tolerated).
if [ -f package.json ]; then
  ln=$(grep -nE '"node"[[:space:]]*:' package.json | head -n1 | cut -d: -f1)
  if command -v node >/dev/null 2>&1; then
    eng=$(node -e 'try{process.stdout.write(String((require("./package.json").engines||{}).node||""))}catch(e){}')
  else
    eng=$(sed -n '/"engines"/,/}/p' package.json | grep -oE '"node"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/')
  fi
  norm=$(printf '%s' "$eng" | tr -d ' ' | sed -E 's/(\.0)+$//')
  [ "$norm" = "$NODE_ENGINE" ] || report package.json "${ln:-1}" "engines.node is '${eng:-<missing>}', expected '$NODE_ENGINE'"
fi

[ "$fail" -eq 0 ] && echo "drift-check: OK"
exit "$fail"
