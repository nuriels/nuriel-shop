# iPhone HEVC → H.264 MP4 for the hero video: evaluation

Research only. Nothing under `/home/user/nuriel-shop` was changed, nothing was committed, and no production server was contacted.
Machine: 4 vCPU Intel Xeon @ 2.10 GHz, 16 GB RAM, ffmpeg 6.1.1 (Ubuntu build: libx264, libx265, zimg).
Every encode ran with `nice -n 15`, pinned to 2 CPUs (`taskset -c 2,3`, which approximates a 2-vCPU VPS) and 2 threads, except the single-thread measurement. Total compute was about 14 minutes. For part of the run another session was running a Supabase stack on this machine (load average up to about 5.8), so treat the **CPU-seconds** as the solid numbers and the wall times as slightly pessimistic.

## 1. Summary and recommendation

**Recommendation:** add server-side conversion as a **background job**, one job at a time, in a **separate low-privilege container** that has **no network**. Use ffmpeg + libx264 `-preset veryfast -crf 23 -maxrate 5M -bufsize 10M`, tone-map HDR to SDR with zscale + tonemap (mobius), and publish only the verified MP4. Keep the original in a **private** bucket and delete it after success. Never convert inside the upload request.

| input (iPhone-like, 15 s)                 | CPU-s | wall s | peak RSS |              MP4 out |
| ----------------------------------------- | ----: | -----: | -------: | -------------------: |
| 1080p30 SDR HEVC (8.3 Mbit/s, 15.7 MB)    |    18 |    9.7 |   300 MB |               9.9 MB |
| 1080p60 HLG 10-bit (12.2 Mbit/s, 23.1 MB) |    40 |     22 |   400 MB |               9.1 MB |
| 2160p30 HLG 10-bit (20.6 Mbit/s, 38.8 MB) |    47 |     25 |   566 MB | 6.7 MB (mobius: 8.1) |
| same 4K, 1 thread on 1 CPU                |    46 |     46 |   474 MB |               6.7 MB |

Findings beyond the conversion itself:

1. **Privacy (verified in code and with a test file):** uploaded videos are stored byte-for-byte unchanged in the **public** bucket `hosp-media`. iPhone-style location metadata is published as-is: ©xyz/loci and `com.apple.quicktime.location.ISO6709`, plus device model and creation date. Images are re-encoded with sharp, which strips this; videos are not. The PoC conversion removes all of it (§4). This applies to gallery videos too.
2. **Parser gap (verified):** `videoInfo()` ignores `tfdt` in fragmented MP4. A crafted 14 MB fMP4 with a real 40 s timeline is measured as **0.078 s** and is **accepted** by today's hero upload (ffprobe and players see 39.97 s). The player's 15.5-s stop limits the damage. A fix sketch is in §6.3.
3. **Size limits vs. iPhone defaults:** 15-s 1080p60 (~23 MB) and 4K30 (~39 MB) clips are refused today by the 20 MB rule. Conversion would allow larger originals while keeping the published MP4 at or under 20 MB; nginx `client_max_body_size 25m` would need raising too. The "Most Compatible" advice probably yields about 32 MB per 15 s at 1080p30 H.264 (≈130 MB/min, third-party figures; _not verified on a device_).

## 2. What the app does today (read from the code)

| step               | where                                                                                            | behaviour                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| form gate          | `validation/media.ts` `parseHeroVideoForm`                                                       | at most `HERO_VIDEO_MAX_BYTES` (20 MiB)                                                                                    |
| length/codec       | `api/media.functions.ts:208-226`                                                                 | `videoInfo` + `heroVideoProblem`: no moov, null length or over 15.5 s is refused. Codec is recorded, not required.         |
| storage            | `server/media.server.ts:6,84,166-169`                                                            | "נשמר כמו שהוא — אין קידוד מחדש" (stored as-is, no re-encode); `bucket.upload(f.path, f.bytes, {cacheControl:"31536000"})` |
| bucket             | `supabase/migrations/20261101110000_hosp_schema.sql:765`                                         | `hosp-media` is **public**, 50 MB, `video/quicktime` allowed                                                               |
| gallery videos     | `media.functions.ts:173-184`                                                                     | any length up to 50 MB, also untouched                                                                                     |
| playback           | `website/components/HeroVideo.tsx:214,219`                                                       | `onError` falls back to the image. Each loop stops at 15.5 s unless the duration is finite and at most 15.5 s.             |
| owner hint         | `management/website/HeroMediaField.tsx:301-309`                                                  | HEVC warning plus the "Most Compatible" advice                                                                             |
| background pattern | `outbox/worker.server.ts` (`tick` every 30 s, `running` flag) and `server/video-check.server.ts` | in-process jobs with the service key; this is where a transcode step plugs in                                              |
| runtime            | `Dockerfile:39,48`                                                                               | `node:22-slim`, `USER node`, **no ffmpeg**. A single `app` service (Coolify).                                              |
| body limit         | `deploy/nginx/nuriel-shop.nuri1.fit.conf:12`                                                     | `client_max_body_size 25m`                                                                                                 |

Public objects carry a 1-year Cache-Control. Leaked originals may stay in browser or CDN caches after deletion.

## 3. Test inputs (`make-inputs.sh`, `craft-lies.ts`)

Content is testsrc2 plus temporal noise, encoded with libx265 at realistic iPhone bitrates. This is a hard case for x264. HLG inputs were converted with zscale to BT.2020 / arib-std-b67 / yuv420p10le (Main10, hvc1). "Parser today" means the app's unmodified `videoInfo` + `heroVideoProblem`.

| id    | what                                                                                           |    size | parser today                                        |
| ----- | ---------------------------------------------------------------------------------------------- | ------: | --------------------------------------------------- |
| a     | 1080p30 8-bit SDR HEVC, AAC, 15 s, 8.3 Mbit/s                                                  | 15.7 MB | 15.02 s hevc, accepted                              |
| b     | 2160p30 10-bit HLG Main10, AAC, 15 s, 20.6 Mbit/s                                              | 38.8 MB | refused: over 20 MB                                 |
| c     | 1080p60 10-bit HLG, 15 s, 12.2 Mbit/s                                                          | 23.1 MB | refused: over 20 MB                                 |
| d     | like (a), 16 s                                                                                 | 16.8 MB | 16.02 s, refused                                    |
| e1    | 16 s of frames; mvhd/tkhd/mdhd patched to 5 s; no edit list                                    | 16.5 MB | 16 s (stts), refused. ffprobe says **5.0 s**.       |
| e2    | fMP4, one fragment per frame, 40 s timeline only in `tfdt`, sample durations = 1 tick          | 14.0 MB | **0.078 s, ACCEPTED**. ffprobe says 39.97 s.        |
| f1    | first 60 % of (a); moov lost                                                                   |  9.4 MB | null, refused                                       |
| f2    | faststart copy of (a) cut at 50 %                                                              |  7.9 MB | 15.02 s, accepted                                   |
| f3    | (a) + 40 × 4 KiB random blocks in mdat                                                         | 15.7 MB | accepted                                            |
| f4    | ftyp plus random bytes                                                                         |  2.0 MB | refused                                             |
| g     | (a) + ©xyz/loci + mdta `com.apple.quicktime.location.ISO6709/make/model/software/creationdate` | 15.7 MB | accepted, **stored untouched in the public bucket** |
| h     | 8192×4320 HEVC, 3 frames                                                                       |   13 KB | 0.1 s, accepted                                     |
| i     | 720p, 600 fps, 15 s = 9000 frames (H.264)                                                      |  235 KB | 15 s, accepted                                      |
| j1–j4 | HLS playlist as .mov/.m3u8, ffconcat, HLS pointing at local files                              |  ≤200 B | refused                                             |
| k     | (a) with a 90° display matrix (portrait)                                                       | 15.7 MB | accepted                                            |

## 4. Location metadata

- **Today:** `prepareMedia()` returns the uploaded bytes unchanged and `storeFiles()` puts them in the public bucket. On (g), ffprobe shows `location=+32.0853+034.7818/`, `com.apple.quicktime.location.ISO6709=+32.0853+034.7818+012.000/`, `model=iPhone 15 Pro` and the creation date. The bytes contain `moov/udta/{meta, loci}`.
- **After conversion** (`out/rec-g-location.mp4`): the only tags left are `major_brand/minor_version/compatible_brands/encoder=Lavf60.16.100` and the stream `encoder` and `handler_name`. There are 0 byte hits for `+32.0853`, `034.7818`, `com.apple`, `iPhone`, `2026-08-14`, `loci` or `mdta`. `mvhd.creation_time=0`. Audio is dropped. The verifier (`gate.ts output`) rejects outputs with any other format tags.
- _Not verified:_ whether the iOS Safari photo picker strips location or transcodes on upload. The leak applies at least to computer, Files, AirDrop and Android uploads.

## 5. Conversion

### 5.1 Exact commands (`logs/final-cmd-*.txt`)

```
ffmpeg -nostdin -hide_banner -nostats -loglevel warning -threads 2 -filter_threads 2 \
  -protocol_whitelist file,pipe -f mov -c:v hevc -t 15.5 -i file:/mnt/in \
  -map 0:v:0 -an -sn -dn -map_metadata -1 -map_chapters -1 \
  -vf "scale=1920:1080:flags=bicubic,format=yuv420p,setsar=1" \
  -c:v libx264 -preset veryfast -crf 23 -maxrate 5M -bufsize 10M -profile:v high -level:v 4.0 \
  -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -threads 2 -t 15.5 -frames:v 466 -movflags +faststart -f mp4 file:/mnt/out.mp4
```

For HDR (ffprobe `color_transfer` is `arib-std-b67` or `smpte2084`), the filter is below. `fps=30` is added only when the source is above 30.5 fps, and it comes first so dropped frames are never tone-mapped:

```
-vf "fps=30,zscale=w=1920:h=1080:filter=bicubic:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,setsar=1"
```

- **Output size:** the wrapper fits a 1920×1080 box (1080×1920 for portrait, after autorotation) and never upscales. Portrait (k) gave 1080×1920 with no rotation side-data left.
- **Forced decoder:** `-c:v hevc|h264` was added after the measurements. It is the same decoder, so there is no performance difference.
- **`-pix_fmt yuv420p` is essential:** this libx264 also does yuv420p10le, which gives High 10 that browsers do not play.

Process prefix (ffmpeg's parent is `timeout`; everything else execs):

```
timeout -k 5 240 unshare -m -n -- sh -c 'mount --bind "$1" /mnt && shift && exec "$@"' sh <jobdir> \
  setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs -- \
  prlimit --cpu=300:305 --as=4294967296 --fsize=67108864 --nofile=256 --core=0 -- nice -n 15 ionice -c 3 ffmpeg …
```

### 5.2 Measurements (`logs/matrix.jsonl`)

Each run went through the full PoC: parser gate → sandboxed ffprobe gate → sandboxed ffmpeg → verification. **Every output passed both the app's parser (15 s, h264, mp4) and ffprobe** (15 s, High, yuv420p, at most 1920×1080, 30 fps, 450 frames, `ftyp>moov>free>mdat`, one stream, no metadata). CPU-s is user+sys of all descendants; peak RSS comes from getrusage (`measure.py`, because `/usr/bin/time` is not installed).

CRF (a, veryfast, no maxrate):

| CRF             | wall | CPU s | RSS MB |    MB | Mbit/s |
| --------------- | ---: | ----: | -----: | ----: | -----: |
| 21              | 10.8 |  20.0 |    299 | 14.99 |   8.00 |
| 23              |  9.4 |  17.8 |    299 | 10.66 |   5.68 |
| 26              |  9.1 |  16.9 |    300 |  6.17 |   3.29 |
| 23 + maxrate 5M |  9.7 |  18.2 |    300 |  9.87 |   5.26 |

Presets (CRF 23, no maxrate):

| input         | preset   | wall | CPU s | RSS |    MB | Mbit/s |
| ------------- | -------- | ---: | ----: | --: | ----: | -----: |
| a 1080p30 SDR | veryfast |  9.4 |  17.8 | 299 | 10.66 |   5.68 |
| a             | fast     | 21.2 |  38.3 | 433 | 13.56 |   7.23 |
| a             | medium   | 24.4 |  44.4 | 506 | 13.25 |   7.07 |
| c 1080p60 HLG | veryfast | 23.4 |  41.4 | 406 |  9.10 |   4.85 |
| c             | fast     | 32.6 |  59.6 | 534 | 10.47 |   5.58 |
| c             | medium   | 34.7 |  62.8 | 609 |  9.80 |   5.22 |
| b 2160p30 HLG | veryfast | 25.9 |  48.3 | 556 |  6.73 |   3.59 |
| b             | fast     | 33.3 |  63.6 | 693 |  7.92 |   4.22 |
| b             | medium   | 35.1 |  65.8 | 762 |  7.67 |   4.09 |

Slower presets cost 1.3–2.5× the CPU and gave larger files at the same CRF on grainy content, so veryfast is the right choice.

Threads (b, veryfast): 1 thread on 1 CPU took 46.5 s wall, 45.9 CPU-s, 474 MB. 2 threads on 2 CPUs took 25.9 s, 48.3 CPU-s, 556 MB. That is 1.8× faster for about 5 % more CPU.

Recommended config (all verified):

| input        | out          | wall | CPU s | RSS |   MB |
| ------------ | ------------ | ---: | ----: | --: | ---: |
| a            | 1920×1080@30 |  9.7 |  18.2 | 300 | 9.87 |
| g (location) | 1920×1080@30 |  9.5 |  18.0 | 298 | 9.87 |
| k (portrait) | 1080×1920@30 | 10.0 |  18.9 | 311 | 9.86 |
| c            | 1920×1080@30 | 22.3 |  39.6 | 400 | 9.10 |
| b, hable     | 1920×1080@30 | 25.1 |  46.8 | 566 | 6.73 |
| b, mobius    | 1920×1080@30 | 26.8 |  49.9 | 559 | 8.12 |

Where the CPU goes (`breakdown.sh`, CPU-s):

- (a): decode 4.4, full 17.8.
- (b): decode 17.4, decode + zscale/tonemap 34.9, full 48.3.
- (c): decode 7.6, decode + fps + tonemap 22.7, full 41.4.

### 5.3 Tone mapping (`tonemap-eval.sh`, `out/tonemap/side-by-side_ref_naive_hable_mobius.png`)

Frame at t=5 s of (c), compared with its SDR source:

| variant                      |           YAVG |            SATAVG |  SSIM |    PSNR |
| ---------------------------- | -------------: | ----------------: | ----: | ------: |
| SDR source                   |          125.6 |             114.4 |     – |       – |
| naive (no colour conversion) |          127.1 | 44.4 (washed out) | 0.759 | 17.2 dB |
| hable                        | 100.2 (darker) |              83.3 | 0.774 | 19.4 dB |
| mobius                       |          120.0 |             102.1 | 0.787 | 26.6 dB |

Mobius is the PoC default. Caveat: the synthetic content has no highlights above SDR white, so check 3–5 real iPhone HDR clips. Dolby Vision 8.4 RPU is ignored; the HLG base layer is what gets tone-mapped.

## 6. Security

### 6.1 Threats

- **Memory-safety bugs in demuxers and decoders.** Examples: CVE-2024-32228 (`hevc_frame_end`, `libavcodec/hevcdec.c`; https://bugzilla.redhat.com/show_bug.cgi?id=2295064, https://tenable.com/cve/CVE-2024-32228), and FFmpeg trac #11407, a heap overflow in `mov_read_trun` (Jan 2025, https://ffmpeg.org/pipermail/ffmpeg-trac/2025-January/). Verify against NVD and ffmpeg.org/security.html. ffprobe runs the same code, so it is sandboxed too.
- **Resource exhaustion:** huge dimensions; 9000 frames in 235 KB; long timelines behind short headers; fps-filter duplication over timestamp gaps; runaway outputs.
- **Playlists and external references:** HLS, concat and dref can open URLs or local files.
- **Process-level risk:** ffmpeg running as the app's uid could read `/proc/<node>/environ`, which holds `SUPABASE_SERVICE_ROLE_KEY`. That is why it belongs in a separate container.

### 6.2 Controls (`logs/security-demos.txt`, `logs/security-demos-extra.txt`)

| control                                                                                                                                                           | status             | evidence                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| size + app parser before any ffmpeg (refuse over 15.5 s, null length, codec not hevc/h264, WebM)                                                                  | verified           | (d) refused at stage `input` in ~100 ms, with **0 ffmpeg/ffprobe execs** (PATH shim) and no job dir. An accepted file shows 3 execs. e1, f1, f4 and j1–j4 are refused the same way.            |
| sandboxed ffprobe gate (long side ≤4096, short side ≤2160, ≤120 fps, ≤1860 frames)                                                                                | verified           | h refused with `dimensions_too_big` (235 ms). i refused with `fps_too_high`. e2 refused because its average fps is 15360 (a side effect).                                                      |
| `-f mov` + fixed name `in`                                                                                                                                        | verified           | an .m3u8 pointing at another local video pulled **65 frames** of it into the output under auto-detection, even with `-protocol_whitelist file,pipe`. With `-f mov`: refused.                   |
| `-protocol_whitelist file,pipe`                                                                                                                                   | verified           | `concat:` and nested http are refused. ffmpeg 6.1 defaults already block SSRF from local playlists (nested whitelist `file,crypto,data`, HLS extension check, concat `safe=1`): 0 canary hits. |
| no network (`unshare -n`)                                                                                                                                         | verified           | a direct URL from the host hit the 127.0.0.1 canary; inside the netns: "Network is unreachable"                                                                                                |
| `-t 15.5` ×2 + `-frames:v 466`                                                                                                                                    | verified           | e1/d forced through give 15.5 s (parser 15.5, ffprobe 15.5, still passes `heroVideoFits`). e2 forced through gives 15.5 s; without `-t` it gives 40 s.                                         |
| output re-verification + atomic publish                                                                                                                           | verified           | 18/18 passed; `.partial` then `mv`                                                                                                                                                             |
| `timeout -k 5`                                                                                                                                                    | verified           | `--timeout 4` killed at 4.6 s, cleaned up                                                                                                                                                      |
| RLIMIT_CPU (soft:hard)                                                                                                                                            | verified           | stopped after 2.4 s (SIGXCPU, ffmpeg exits 255; the label is cosmetic)                                                                                                                         |
| RLIMIT_AS                                                                                                                                                         | verified           | 700 MB on 4K gives `memory_limit`                                                                                                                                                              |
| RLIMIT_FSIZE / core 0 / nofile                                                                                                                                    | verified (fsize)   | 1 MB gives SIGXFSZ, `file_size_limit`                                                                                                                                                          |
| nice / ionice / taskset                                                                                                                                           | verified           | every run                                                                                                                                                                                      |
| nobody, no_new_privs, mount ns with only the job dir                                                                                                              | verified           | `ps` shows ffmpeg as `nobody`                                                                                                                                                                  |
| corrupt or truncated input                                                                                                                                        | behaviour verified | f3: exit 0, 48 decoder errors, 15 s output. f2: 7.3 s output. **Proposed:** fail above about 10 error lines, or when the output is more than 1 s shorter than the input.                       |
| one job at a time                                                                                                                                                 | documented         | outbox `running` flag plus SKIP LOCKED claim                                                                                                                                                   |
| container `--network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 1g --memory-swap 1g --cpus 1 --user 10001 --tmpfs` | documented only    | no usable Docker daemon; one started by another session was left untouched                                                                                                                     |
| minimal ffmpeg build (`--disable-everything` + mov/hevc/h264/libx264/mp4/file/zimg filters), seccomp, regular updates                                             | documented only    |                                                                                                                                                                                                |

### 6.3 Duration limit end to end

- **Before:** the parser takes the longest of mvhd, mehd, each mdhd, each stts sum and the trun sums, which catches e1. Never gate on ffprobe `format.duration`: it said 5.0 s for e1.
- **During:** `-t 15.5` plus `-frames:v 466`.
- **After:** the parser and ffprobe re-measure our own non-fragmented MP4.
- **Gap:** `fragmentedSeconds()` ignores `tfdt` (baseMediaDecodeTime), which ffmpeg (`-use_tfdt`, on by default) and players use. Fix: for each video traf, `end = max(end, tfdt + Σ durations)`, and return `max(total, end) / timescale`. Also treat more than 240 fps (sample count ÷ duration) as unreadable.

### 6.4 Temp files (`hero-transcode.sh`, `sweep.sh`): kill tests on the 4K job

Each job gets `mktemp -d <spool>/hero.XXXXXXXX` (mode 700) holding `owner.pid` and `child.pid`. A trap on EXIT/TERM/INT/HUP signals the `timeout` process group and removes the dir. ffmpeg runs in the background with `wait`, so the trap fires immediately.

| scenario                    | exit       | job dir                                        | published | leftovers                                                                  |
| --------------------------- | ---------- | ---------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| kill -9 ffmpeg              | 4 (killed) | removed by trap                                | no        | none                                                                       |
| kill -TERM wrapper          | 143        | removed by trap                                | no        | none                                                                       |
| kill -9 wrapper             | 137        | still there (38 MB: in, partial out.mp4, logs) | no        | timeout (parent now PID 1) + ffmpeg (nobody) still running                 |
| … then `sweep.sh`           | –          | removed                                        | –         | none (killed process group 17706; it checks the cmdline names the job dir) |
| stale dir with a dead owner | –          | removed by sweeper                             | –         | –                                                                          |

`timeout` runs in its own process group, so killing the wrapper's group does not reach ffmpeg. Target `child.pid`'s group instead. Even without the sweeper, `timeout` caps how long an orphan lives. Run the sweeper at start-up and every few minutes.

## 7. Costs on a small VPS

- **Per clip on this CPU:** 18 / 40 / 47 CPU-s (1080p30 SDR / 1080p60 HLG / 4K30 HLG), 300–570 MB RAM. Budget about 2× for shared vCPUs.
- **2-vCPU VPS shared with the web app:** 1 thread, concurrency 1. A 4K HDR clip then blocks one core for about 46 s (about 90 s on a slow vCPU). Use 2 threads only on a 4-vCPU host.
- **Budget per job:** timeout 180 s, RLIMIT_CPU 180/185 s, memory 1 GB, fsize 64 MB, nice 15, ionice idle, `cpus: 1.0`.
- **Never in the upload request:** a 4K job would hold the request for 25–46 s, and parallel uploads would starve the site.
- **Volume:** 100 clips a day × 48 CPU-s ≈ 80 CPU-min a day, about 6 % of one core.

## 8. Alternatives

- **(a) Self-hosted ffmpeg worker in a separate container (recommended).** Cost is the CPU above, data stays on the server, and you control the isolation fully. Use Debian ffmpeg, pinned and updated, or a minimal GPL build.
- **(b) In the browser.**
  - **WebCodecs** (+ mp4box.js or Mediabunny): HEVC decode and H.264 encode are hardware-accelerated in Safari on iOS 16.4+, which is where iPhone clips start. Chrome decodes HEVC only with hardware support, and Firefox support is limited. HDR handling varies, and the page must stay open. The result is untrusted, so the server still checks h264 and ≤15.5 s with the parser, but never decodes.
  - **ffmpeg.wasm:** software HEVC in WASM is many times slower (native needed 17 CPU-s just to decode the 4K clip), downloads about 30 MB, needs COOP/COEP for threads, and risks iOS memory kills. Not practical on phones.
  - Neither was measured.
- **(c) Managed services.**
  - **Cloudflare Stream:** $5 per 1,000 min stored (prepaid), $1 per 1,000 min delivered, encoding free (https://developers.cloudflare.com/stream/pricing, via web search 2026-11-09; the page could not be opened from this sandbox). Example: a 15-s hero on 20k views a month is about $5 per site per month plus storage.
  - **Mux: pricing to be checked.** Search results conflict: basic encoding free, 1080p storage about $0.0024–0.0030/min/month, delivery about $0.0008–0.0012/min (https://mux.com/pricing, https://www.mux.com/docs/pricing/video, searched 2026-11-09).
  - **AWS MediaConvert: pricing to be checked.** Billed per output minute; the HD AVC rate is unconfirmed (a third party cites $0.0075/min for Basic SD 30 fps); you also need S3, IAM and delivery (https://aws.amazon.com/mediaconvert/pricing).
  - **Privacy:** the original, with location, faces and timestamps, leaves the server. That needs a processing agreement and a privacy-policy update, and HLS delivery would change `HeroVideo.tsx`.

## 9. Implementation outline (not implemented)

1. **Upload** (`hospitalityUploadHeroVideo`, and `hospitalityUploadMedia` for gallery videos):
   - Keep the parser gate.
   - Optionally allow originals up to 50 MB (raise nginx too); keep 20 MB for the published MP4.
   - Store the original in a new private bucket `hosp-media-private` (service-role only).
   - Insert the media row with `processing_status='pending'`, call `kickOutbox()`, and return "preparing".
2. **Migration:**
   - New columns: `processing_status` (`pending|processing|ready|failed`), `processing_error`, `original_path`, `processing_attempts`, `processing_locked_until`.
   - Service-key RPCs: `media_video_claim()` (SKIP LOCKED, 10-min lease), `media_video_processed(...)`, `media_video_failed(...)`.
   - `_public_media` and `site_publish` treat pending like today's "not verified".
3. **Job:** a `runVideoTranscodes()` step in `outbox/worker.server.ts`, one job per tick. It should:
   - download the original with the service key;
   - write it to the spool volume;
   - have the transcoder container (`network_mode: none`, `read_only`, `cap_drop ALL`, `no-new-privileges`, `pids_limit`, `mem_limit 1g`, `cpus 1.0`, tmpfs, spool `in:ro` / `out:rw`, running the hardened `hero-transcode.sh`) produce the MP4;
   - re-verify in the app (videoInfo h264, ≤15.5 s, ≤20 MB, faststart);
   - upload `<tenant>/<uuid>.mp4` to `hosp-media`;
   - call `media_video_processed` and `media_video_verified`.

   Failures become `failed` with a Hebrew reason. Retry at most twice for infrastructure errors, never for refused inputs. The sweeper resets leases and removes stale dirs.

4. **Original:** never public. Delete right after success (or within 24–72 h). Keep failed ones at most 7 days, then delete via `apply_retention`.
5. **Owner UI** (`HeroMediaField.tsx`): "Preparing… / Ready / Failed: reason" with re-upload, polling every 5 s, and the image shown until ready.
6. **Remediation:** back-fill the existing public videos (they may leak location now), bearing the 1-year cache in mind. Apply the `tfdt` parser fix.
7. **Tests:** an HEVC fixture with location, checking for h264 output with no tags. Add e1/e2/f1 parser fixtures, state-machine unit tests, and an e2e test for upload → ready.

## 10. Notes for legal and product

- **Licensing:** this ffmpeg is built with `--enable-gpl` and libx264 (GPLv2+). Running it on your own server is not distribution. Distributing the image (public registry, customers self-hosting) triggers GPL source obligations. Calling ffmpeg as a separate process keeps the app non-GPL. For legal review.
- **Patents:** the H.264 pool (Via LA) has historically not charged for internet video free to end users, but encoder and decoder products have their own terms. Server-side HEVC decoding may fall under the HEVC pools (Access Advance, Via LA). Not legal advice. Managed services include codec licensing.
- **Zero-cost workaround:** Settings → Camera → Formats → "Most Compatible" records H.264 (SDR). At about 130 MB/min for 1080p30 (third-party, e.g. https://www.imore.com/how-shoot-trim-edit-and-share-4k-video-iphone-6s), a 15-s clip is about 32 MB, over the 20 MB limit and nginx's 25 MB. It fits only for about 9 s or less, or at 720p. Verify on a device.
- **HEVC already plays for many visitors:** Safari on iOS and macOS plays it natively, and Chrome/Edge do where hardware decoding exists. Others get the image fallback. Conversion adds universal playback, privacy, a consistent SDR look, lighter files (39 MB → 7–8 MB; 23 MB → 9 MB) and 30 fps.
- **Page weight:** with `preload="auto"`, 5 Mbit/s × 15 s is about 10 MB per visitor. Consider 3–4 Mbit/s or a 720p mobile rendition.

## 11. Not verified / caveats

Not tested:

- real iPhone files (Dolby Vision 8.4, `dvh1`, variable frame rate, exact bitrates);
- the iOS picker's behaviour;
- browsers on e2;
- Docker, seccomp and a minimal build;
- in-browser conversion;
- Mux and MediaConvert prices, and the Cloudflare page itself.

Other caveats:

- Synthetic noisy content is a hard case; real clips will differ.
- The tone-mapping choice was judged only on synthetic HLG.

## 12. Files

In this folder (research only — the app does not use them, and nothing was installed on any server):

- `hero-transcode.sh`: the PoC wrapper (stages: parser gate → sandboxed ffprobe → sandboxed ffmpeg → verification → atomic publish).
- `gate.ts`: the decision logic; it imports the app's own parser (`src/engines/hospitality/media/video-info.ts`).
- `sweep.sh`: the stale-dir and orphan sweeper.

The other measurement scripts, the test inputs and the outputs stayed in the research environment. Since this report was written, the app's parser measures fragmented MP4 by `tfdt` (§6.3 is fixed) and uploaded videos are stored without location / device / date metadata (§4, for new uploads).
