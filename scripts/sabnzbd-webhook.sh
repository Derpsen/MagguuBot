#!/bin/sh
#
# MagguuBot — SABnzbd post-processing script.
#
# Install:
#   1. Copy to SABnzbd's scripts folder (Config -> Folders -> Post-Processing Scripts).
#   2. chmod +x sabnzbd-webhook.sh
#   3. In Config -> Categories (or per job): set this as the Script.
#   4. Set env vars on the SABnzbd container:
#        MAGGUU_BOT_URL=http://magguu-bot:3000
#        MAGGUU_TOKEN=<your WEBHOOK_SECRET>
#
# SABnzbd passes these positional args after each job:
#   $1 = final directory of the job
#   $2 = original NZB name
#   $3 = clean job name
#   $4 = indexer report number
#   $5 = category
#   $6 = group
#   $7 = post-processing status (0=OK, 1=failed verification, 2=failed unpack,
#                                 3=failed both, -1=crashed)
#   $8 = URL of related NZB
#
# Security: token is read from env, never from args. Webhook runs over the
# internal Docker network; if you must reach it over WAN, use HTTPS + mTLS.
#
set -eu

: "${MAGGUU_BOT_URL:?set MAGGUU_BOT_URL (e.g. http://magguu-bot:3000)}"
: "${MAGGUU_TOKEN:?set MAGGUU_TOKEN (same value as WEBHOOK_SECRET)}"

FINAL_DIR="${1:-}"
JOB_NAME="${3:-${2:-unknown}}"
CATEGORY="${5:-}"
STATUS_CODE="${7:-0}"

case "$STATUS_CODE" in
  0)  EVENT="complete"; FAIL_MSG="" ;;
  1)  EVENT="failed";   FAIL_MSG="Failed verification (par2 check)" ;;
  2)  EVENT="failed";   FAIL_MSG="Failed unpack" ;;
  3)  EVENT="failed";   FAIL_MSG="Failed verification and unpack" ;;
  -1) EVENT="failed";   FAIL_MSG="Script crashed" ;;
  *)  EVENT="failed";   FAIL_MSG="Unknown status ${STATUS_CODE}" ;;
esac

SIZE_BYTES=0
if [ -n "${FINAL_DIR}" ] && [ -d "${FINAL_DIR}" ]; then
  SIZE_BYTES=$(du -sb "${FINAL_DIR}" 2>/dev/null | awk '{print $1}')
  SIZE_BYTES=${SIZE_BYTES:-0}
fi

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'; }

PAYLOAD=$(cat <<EOF
{
  "event": "${EVENT}",
  "name": "$(json_escape "${JOB_NAME}")",
  "category": "$(json_escape "${CATEGORY}")",
  "sizeBytes": ${SIZE_BYTES},
  "failMessage": "$(json_escape "${FAIL_MSG}")",
  "storageDir": "$(json_escape "${FINAL_DIR}")"
}
EOF
)

curl -fsS --max-time 10 \
  -X POST \
  -H 'Content-Type: application/json' \
  -H "X-Magguu-Token: ${MAGGUU_TOKEN}" \
  --data "${PAYLOAD}" \
  "${MAGGUU_BOT_URL%/}/webhook/sabnzbd" >/dev/null || {
    printf 'MagguuBot webhook failed for job: %s\n' "${JOB_NAME}" >&2
    exit 0
  }

exit 0
