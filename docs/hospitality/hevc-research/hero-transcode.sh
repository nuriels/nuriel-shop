#!/usr/bin/env bash
# hero-transcode.sh — PoC (research only): untrusted iPhone video → web-safe hero MP4
#   H.264 High · yuv420p 8-bit · ≤1920×1080 (portrait ≤1080×1920, never upscaled) · ≤30 fps
#   ≤15.5 s · no audio / subtitles / data / chapters / metadata · faststart · HDR→SDR tone-mapped
#
# usage: hero-transcode.sh [options] <input> <output.mp4>
#   --preset P (veryfast)  --crf N (23)  --maxrate R (5M, "0" = none)  --threads N (2)
#   --tonemap mobius|hable|reinhard (mobius)  --npl N (100)  --cpus LIST (taskset, optional)
#   --max-in-bytes N (20 MiB)  --max-out-bytes N (20 MiB)  --cap S (15.5)
#   --timeout S (240 wall)  --cpu S (300 CPU-s)  --as-mb N (4096)  --fsize-mb N (64)
#   --spool DIR (dedicated parent of per-job work dirs)  --no-gate (skip stage-1 parser gate:
#   measurement / lying-file experiments only)  --no-sandbox  --measure LABEL (wrap ffmpeg in
#   measure.py)  --keep-cmd FILE (write the exact ffmpeg argv there)
# exit: 0 published · 2 usage · 3 refused before decoding · 4 conversion failed/killed/timeout
#       · 5 output failed verification
set -Eeuo pipefail
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"

PRESET=veryfast CRF=23 MAXRATE=5M THREADS=2 TONEMAP=mobius NPL=100 CPUS=""
MAX_IN=$((20 * 1024 * 1024)) MAX_OUT=$((20 * 1024 * 1024)) CAP=15.5
TIMEOUT=240 CPU=300 AS_MB=4096 FSIZE_MB=64 SPOOL="$HERE/spool"
GATE=1 SANDBOX=1 MEASURE="" KEEP_CMD=""
while [[ $# -gt 2 ]]; do
  case "$1" in
    --preset) PRESET=$2; shift 2 ;;      --crf) CRF=$2; shift 2 ;;
    --maxrate) MAXRATE=$2; shift 2 ;;    --threads) THREADS=$2; shift 2 ;;
    --tonemap) TONEMAP=$2; shift 2 ;;    --npl) NPL=$2; shift 2 ;;
    --cpus) CPUS=$2; shift 2 ;;          --cap) CAP=$2; shift 2 ;;
    --max-in-bytes) MAX_IN=$2; shift 2 ;; --max-out-bytes) MAX_OUT=$2; shift 2 ;;
    --timeout) TIMEOUT=$2; shift 2 ;;    --cpu) CPU=$2; shift 2 ;;
    --as-mb) AS_MB=$2; shift 2 ;;        --fsize-mb) FSIZE_MB=$2; shift 2 ;;
    --spool) SPOOL=$2; shift 2 ;;        --no-gate) GATE=0; shift ;;
    --no-sandbox) SANDBOX=0; shift ;;    --measure) MEASURE=$2; shift 2 ;;
    --keep-cmd) KEEP_CMD=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[[ $# -eq 2 ]] || { echo "usage: $0 [options] <input> <output.mp4>" >&2; exit 2; }
IN=$1 OUT=$2
# whitelist every value that ends up on a command line
[[ $PRESET =~ ^(ultrafast|superfast|veryfast|faster|fast|medium|slow)$ && $CRF =~ ^[0-9]{1,2}$ &&
   $MAXRATE =~ ^[0-9]+[kM]?$ && $THREADS =~ ^[1-8]$ && $TONEMAP =~ ^(hable|mobius|reinhard)$ &&
   $NPL =~ ^[0-9]{2,4}$ && $CAP =~ ^[0-9]+(\.[0-9]+)?$ && $CPUS =~ ^[0-9,-]*$ ]] ||
  { echo "bad option value" >&2; exit 2; }

status() { # one JSON line on stdout: the only machine-readable output
  printf '{"ok":%s,"stage":"%s","reason":"%s","input":%s,"plan":%s,"ffmpeg":%s,"output":%s}\n' \
    "$1" "$2" "$3" "${GATE_JSON:-null}" "${PLAN_JSON:-null}" "${FF_JSON:-null}" "${OUT_JSON:-null}"
}
JOB="" CHILD="" GATE_JSON="" PLAN_JSON="" FF_JSON="" OUT_JSON=""

# ---- stage 1: before ANY ffmpeg code touches the bytes: the app's own pure-TS parser ----------
if [[ ! -f $IN || -L $IN ]]; then status false input not_a_regular_file; exit 3; fi
if ((GATE)); then
  if ! GATE_JSON=$(node "$HERE/gate.ts" input "$IN" "$MAX_IN"); then
    status false input "$(sed -E 's/.*"reason":"([a-z_]+)".*/\1/' <<<"$GATE_JSON")"; exit 3
  fi
fi

# ---- per-job work dir under a dedicated spool; always removed (trap), stale ones swept --------
mkdir -p "$SPOOL"; chmod 711 "$SPOOL"
JOB=$(mktemp -d "$SPOOL/hero.XXXXXXXX")
echo $$ > "$JOB/owner.pid"
cleanup() {
  local rc=$?
  trap - EXIT TERM INT HUP
  if [[ -n $CHILD ]] && kill -0 "$CHILD" 2>/dev/null; then
    kill -TERM -- "-$CHILD" 2>/dev/null || kill -TERM "$CHILD" 2>/dev/null || true
    for _ in {1..30}; do kill -0 "$CHILD" 2>/dev/null || break; sleep 0.1; done
    kill -KILL -- "-$CHILD" 2>/dev/null || true
    wait "$CHILD" 2>/dev/null || true
  fi
  [[ -n $JOB && -d $JOB ]] && rm -rf -- "$JOB"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 143' TERM; trap 'exit 130' INT; trap 'exit 129' HUP

cp -- "$IN" "$JOB/in"            # ffmpeg sees only a fixed name inside the job dir
SB=() JD="$JOB"                   # sandbox prefix for every ffmpeg / ffprobe run; JD = job dir as ffmpeg sees it
SANDBOXED=none
if ((SANDBOX)) && [[ $(id -u) -eq 0 ]]; then
  chown 65534:65534 "$JOB" "$JOB/in"; chmod 700 "$JOB"
  if unshare -m -n true 2>/dev/null; then
    # private mount + network namespace: no network interfaces except a down "lo"; the job dir is
    # bind-mounted at /mnt (visible only inside); then drop to nobody with no_new_privs
    SB+=(unshare -m -n -- sh -c 'mount --bind "$1" /mnt && shift && exec "$@"' sh "$JOB")
    JD=/mnt SANDBOXED="netns+mountns+nobody"
    SB+=(setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs --)
  fi
fi
LIM=(prlimit --cpu="$CPU:$((CPU + 5))" --as=$((AS_MB * 1024 * 1024)) --fsize=$((FSIZE_MB * 1024 * 1024))
     --nofile=256 --core=0 --)
NICE=(nice -n 15 ionice -c 3)
[[ -n $CPUS ]] && NICE+=(taskset -c "$CPUS")
run_limited() { # $1 wall-timeout, rest = command; runs in its own process group (timeout)
  local t=$1; shift
  timeout -k 5 "$t" "${SB[@]}" "${LIM[@]}" "${NICE[@]}" "$@" &
  CHILD=$!; echo "$CHILD" > "$JOB/child.pid"
  local rc=0; wait "$CHILD" || rc=$?
  CHILD=""; return "$rc"
}
PROTO=(-protocol_whitelist file,pipe -f mov)   # never auto-detect the demuxer, never open URLs

# ---- stage 2: ffprobe (also ffmpeg code → same sandbox) — dimensions, frames, HDR, rotation ---
if ! run_limited 20 ffprobe -v error -hide_banner "${PROTO[@]}" -select_streams v:0 \
     -show_entries "stream=codec_name,codec_tag_string,profile,width,height,pix_fmt,color_transfer,color_primaries,color_space,r_frame_rate,avg_frame_rate,nb_frames:stream_side_data=rotation" \
     -of json "file:$JD/in" > "$JOB/probe.json" 2> "$JOB/probe.err"; then
  status false probe "ffprobe_failed"; exit 3
fi
if ! PLAN=$(node "$HERE/gate.ts" probe "$JOB/probe.json"); then
  status false probe "$(sed -n 's/^REFUSE=//p' <<<"$PLAN")"; exit 3
fi
declare -A P=()
while IFS='=' read -r k v; do [[ $k =~ ^[A-Z_]+$ && $v =~ ^[0-9a-z.-]+$ ]] && P[$k]=$v; done <<<"$PLAN"
[[ ${P[CODEC]:-} =~ ^(hevc|h264)$ ]] || { status false probe codec_not_allowed; exit 3; }
PLAN_JSON=$(printf '{"src":"%sx%s","rotated":%s,"out":"%sx%s","src_fps":%s,"fps_cap":%s,"frames":%s,"hdr":"%s","bits":%s,"sandbox":"%s"}' \
  "${P[SRC_W]}" "${P[SRC_H]}" "${P[ROTATED]}" "${P[OUT_W]}" "${P[OUT_H]}" "${P[SRC_FPS]}" \
  "${P[FPS_CAP]}" "${P[FRAMES]}" "${P[HDR]}" "${P[BITS]}" "$SANDBOXED")

# ---- stage 3: the conversion --------------------------------------------------------------------
VF=""
[[ ${P[FPS_CAP]} == 1 ]] && VF="fps=30,"                 # drop frames before any heavy filter
SIZE="w=${P[OUT_W]}:h=${P[OUT_H]}"
if [[ ${P[HDR]} != none ]]; then                          # HLG / PQ → SDR BT.709, tone-mapped
  VF+="zscale=$SIZE:filter=bicubic:t=linear:npl=$NPL,format=gbrpf32le,zscale=p=bt709,"
  VF+="tonemap=tonemap=$TONEMAP:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
elif [[ ${P[WIDE]} == 1 ]]; then                          # BT.2020 SDR → BT.709 gamut
  VF+="zscale=$SIZE:filter=bicubic:p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p"
else
  VF+="scale=${P[OUT_W]}:${P[OUT_H]}:flags=bicubic,format=yuv420p"
fi
VF+=",setsar=1"
RATE=()
[[ $MAXRATE != 0 ]] && RATE=(-maxrate "$MAXRATE" -bufsize "$(( ${MAXRATE%[kM]} * 2 ))${MAXRATE//[0-9]/}")
FF=(ffmpeg -nostdin -hide_banner -nostats -loglevel warning
    -threads "$THREADS" -filter_threads "$THREADS" "${PROTO[@]}" -c:v "${P[CODEC]}" -t "$CAP" -i "file:$JD/in"
    -map 0:v:0 -an -sn -dn -map_metadata -1 -map_chapters -1
    -vf "$VF"
    -c:v libx264 -preset "$PRESET" -crf "$CRF" "${RATE[@]}" -profile:v high -level:v 4.0
    -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv
    -threads "$THREADS" -t "$CAP" -frames:v 466 -movflags +faststart -f mp4 "file:$JD/out.mp4")
[[ -n $KEEP_CMD ]] && printf '%q ' "${FF[@]}" > "$KEEP_CMD"
T0=$(date +%s.%N); RC=0
if [[ -n $MEASURE ]]; then
  FF_JSON=$(python3 -I "$HERE/measure.py" "$MEASURE" "$JOB/ffmpeg.log" -- \
              timeout -k 5 "$TIMEOUT" "${SB[@]}" "${LIM[@]}" "${NICE[@]}" "${FF[@]}") || RC=$?
else
  run_limited "$TIMEOUT" "${FF[@]}" 2> "$JOB/ffmpeg.log" || RC=$?
  FF_JSON=$(printf '{"exit":%s,"wall_s":%.2f}' "$RC" "$(echo "$(date +%s.%N) - $T0" | bc 2>/dev/null || echo 0)")
fi
ERRS=$(grep -ciE 'error|invalid|corrupt|missing' "$JOB/ffmpeg.log" || true)
FF_JSON=${FF_JSON%\}}",\"log_error_lines\":$ERRS}"
if [[ $RC -ne 0 ]]; then
  case $RC in 124) why=timeout ;; 137) why=killed ;; 152) why=cpu_limit ;; 153) why=file_size_limit ;;
              *) why="ffmpeg_exit_$RC" ;; esac
  grep -q 'received signal 24' "$JOB/ffmpeg.log" && why=cpu_limit       # SIGXCPU (soft RLIMIT_CPU)
  grep -qi 'cannot allocate memory' "$JOB/ffmpeg.log" && why=memory_limit
  grep -q 'received signal 15' "$JOB/ffmpeg.log" && [[ $why != cpu_limit ]] && why=terminated
  tail -n 5 "$JOB/ffmpeg.log" >&2 || true
  status false convert "$why"; exit 4
fi

# ---- stage 4: verify the result before it may replace anything (the output is untrusted too) --
if ! run_limited 20 ffprobe -v error -hide_banner -protocol_whitelist file -f mp4 \
     -show_entries "stream=codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate,nb_frames:format=duration:format_tags" \
     -of json "file:$JD/out.mp4" > "$JOB/out.json" 2>/dev/null; then
  status false verify ffprobe_failed; exit 5
fi
if ! OUT_JSON=$(node "$HERE/gate.ts" output "$JOB/out.mp4" "$MAX_OUT" "$JOB/out.json"); then
  status false verify output_rejected; exit 5
fi
# ---- publish atomically (same-directory temp name + rename) ------------------------------------
cp -- "$JOB/out.mp4" "$OUT.partial.$$" && mv -f -- "$OUT.partial.$$" "$OUT"
status true done ok
