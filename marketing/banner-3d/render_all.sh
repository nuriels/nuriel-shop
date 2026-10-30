#!/usr/bin/env bash
# מרנדר את שתי הגרסאות ומקודד MP4 / WebM / GIF לתיקיית out/
set -euo pipefail
cd "$(dirname "$0")"
SAMPLES=${SAMPLES:-32}
for layout in desktop mobile; do
  python3 scene.py --layout "$layout" --out "build/frames/$layout" --samples "$SAMPLES" 2>&1 | grep --line-buffered -E "rendered|Error|Traceback"
done
./encode.sh
