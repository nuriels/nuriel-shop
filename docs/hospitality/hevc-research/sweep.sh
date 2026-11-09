#!/usr/bin/env bash
# sweep.sh — crash recovery for the hero-transcode spool (run at worker start-up and every few minutes).
# A job dir is stale when its owner (the wrapper) is gone: owner.pid missing/dead/reused, or the dir is
# older than --max-age-min even though the owner looks alive (a hung job). Leftover conversion
# processes (the `timeout` process-group leader recorded in child.pid, and ffmpeg inside it) are killed
# only if their command line still names this job dir (guards against PID reuse), then the dir goes.
# usage: sweep.sh <spool> [--max-age-min N (30)] [--dry-run]
set -uo pipefail
SPOOL=${1:?spool dir}; shift
MAX_AGE=30 DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in --max-age-min) MAX_AGE=$2; shift 2 ;; --dry-run) DRY=1; shift ;; *) exit 2 ;; esac
done
[[ -d $SPOOL ]] || exit 0
names_job() { [[ -r /proc/$1/cmdline ]] && tr '\0' ' ' < "/proc/$1/cmdline" | grep -qF -- "$2"; }
now=$(date +%s)
for job in "$SPOOL"/hero.*; do
  [[ -d $job && ! -L $job ]] || continue
  [[ $(basename "$job") =~ ^hero\.[A-Za-z0-9]{8}$ ]] || continue          # only our own mktemp names
  age_min=$(( (now - $(stat -c %Y "$job")) / 60 ))
  owner=$(cat "$job/owner.pid" 2>/dev/null || true)
  alive=0
  [[ $owner =~ ^[0-9]+$ ]] && names_job "$owner" hero-transcode && alive=1
  if ((alive)) && ((age_min < MAX_AGE)); then echo "active  $job (owner $owner, ${age_min} min)"; continue; fi
  child=$(cat "$job/child.pid" 2>/dev/null || true)
  if [[ $child =~ ^[0-9]+$ ]] && names_job "$child" "$job"; then
    echo "kill    process group $child of $job"
    ((DRY)) || { kill -KILL -- "-$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true; }
  fi
  if ((alive)); then
    echo "kill    hung owner $owner of $job (${age_min} min)"
    ((DRY)) || kill -KILL "$owner" 2>/dev/null || true
  fi
  echo "remove  $job (owner ${owner:-?} $([[ $alive == 1 ]] && echo hung || echo gone), ${age_min} min)"
  ((DRY)) || rm -rf -- "$job"
done
