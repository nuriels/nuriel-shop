#!/usr/bin/env bash
# מקודד את הפריימים: MP4 (לאתר), WebM, ו-GIF מוקטן (עד 8MB — מגבלת האתר)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
enc() { # name frames gif_width gif_fps colors
  local name=$1 dir=$2 gw=$3 gf=$4 col=$5
  ffmpeg -y -loglevel error -framerate 25 -i "$dir/f%04d.png" -c:v libx264 -preset slow -crf 17 \
    -pix_fmt yuv420p -profile:v high -movflags +faststart -an "out/$name.mp4"
  ffmpeg -y -loglevel error -i "out/$name.mp4" -c:v libvpx-vp9 -b:v 0 -crf 30 -row-mt 1 -an "out/$name.webm"
  ffmpeg -y -loglevel error -i "out/$name.mp4" -vf \
    "fps=$gf,scale=$gw:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=$col:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
    -loop 0 "out/$name.gif"
}
enc yayin-kyad-hamelech-desktop-1920x600 build/frames/desktop 960 15 200
enc yayin-kyad-hamelech-mobile-800x800 build/frames/mobile 600 15 200
ls -la out
