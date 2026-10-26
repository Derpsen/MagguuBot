#!/bin/sh
# undici-watch-issue.sh <result.json> - create one issue per report in the result file of scripts/undici-watch.mjs.
# Dedupe by EXACT title over ALL issue states (open or closed): a report is made once; Marco closing it means "seen".
# Needs gh (GH_TOKEN, REPO=owner/name), jq. Title/body only travel as data (jq -r, files, quoted variables).
# Env: REPO (required), ASSIGNEE (default Derpsen), LABEL (default dependencies).
set -eu
file=${1:?usage: undici-watch-issue.sh <result.json>}
: "${REPO:?REPO is required}"
assignee=${ASSIGNEE:-Derpsen}
label=${LABEL:-dependencies}
n=$(jq '.issues | length' "$file")
i=0
while [ "$i" -lt "$n" ]; do
  title=$(jq -r ".issues[$i].title" "$file")
  jq -r ".issues[$i].body" "$file" > "${file}.body.md"
  existing=$(gh issue list --repo "$REPO" --state all --search "in:title \"$title\"" --json number,title |
    jq -r --arg t "$title" '[.[] | select(.title == $t)][0].number // empty')
  if [ -n "$existing" ]; then
    echo "undici-watch: issue #$existing already exists for \"$title\", nothing created"
  else
    gh label create "$label" --repo "$REPO" >/dev/null 2>&1 || true
    gh issue create --repo "$REPO" --title "$title" --body-file "${file}.body.md" --label "$label" --assignee "$assignee"
  fi
  rm -f "${file}.body.md"
  i=$((i + 1))
done
