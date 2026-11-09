// Decision logic for the hero-video conversion PoC. Uses the app's own, unmodified pure-TS parser
// (src/engines/hospitality/media/video-info.ts) — memory-safe, no ffmpeg involved.
//
//   gate.ts input  <file> <maxBytes>        BEFORE any decoding: size, container, length, codec
//   gate.ts probe  <ffprobe.json>           after ffprobe (sandboxed): dimensions, frames, HDR,
//                                           rotation → plan as KEY=value lines for the wrapper
//   gate.ts output <file> <maxBytes> <ffprobe.json>  the produced MP4, before it may be published
//
// Exit: 0 ok · 3 refused (input / probe) · 5 output failed verification. Prints one JSON line
// (input / output) or KEY=value lines (probe), all values plain numbers / fixed tokens.
import { readFileSync, statSync } from "node:fs";
import {
  videoInfo,
  heroVideoFits,
  HERO_VIDEO_MAX_SECONDS,
  HERO_VIDEO_TOLERANCE_SECONDS,
} from "../../../src/engines/hospitality/media/video-info.ts";

const LIMIT_S = HERO_VIDEO_MAX_SECONDS + HERO_VIDEO_TOLERANCE_SECONDS; // 15.5
const MAX_LONG = 4096,
  MAX_SHORT = 2160; // largest accepted coded picture (either orientation)
const MAX_FPS = 120; // iPhone records up to 4K120 / 1080p240 (slo-mo); 240 fps is refused
const MAX_FRAMES = Math.ceil(LIMIT_S * MAX_FPS); // 1860 — bounds decode work regardless of bytes
const OUT_FPS = 30,
  OUT_MAX_FRAMES = Math.ceil(LIMIT_S * OUT_FPS) + 1; // 466
const BOX_LONG = 1920,
  BOX_SHORT = 1080;

const [mode, ...args] = process.argv.slice(2);
const done = (code: number, obj: Record<string, unknown>) => {
  console.log(JSON.stringify(obj));
  process.exit(code);
};

/** top-level box order: faststart = moov before mdat */
function topLevel(b: Uint8Array): string[] {
  const out: string[] = [];
  for (let at = 0; at + 8 <= b.length && out.length < 64;) {
    const v = new DataView(b.buffer, b.byteOffset);
    let size = v.getUint32(at);
    if (size === 1 && at + 16 <= b.length) size = Number(v.getBigUint64(at + 8));
    if (size === 0) size = b.length - at;
    if (size < 8) break;
    out.push(String.fromCharCode(...b.subarray(at + 4, at + 8)));
    at += size;
  }
  return out;
}

const rate = (s: string | undefined) => {
  const [n, d] = String(s ?? "0/1")
    .split("/")
    .map(Number);
  return d ? n! / d : 0;
};

if (mode === "input") {
  const [file, maxBytesArg] = args;
  const size = statSync(file!).size;
  const maxBytes = Number(maxBytesArg);
  if (size === 0) done(3, { ok: false, stage: "input", reason: "empty", size });
  if (size > maxBytes) done(3, { ok: false, stage: "input", reason: "too_big", size, maxBytes });
  // read only what the size check allowed
  const info = videoInfo(new Uint8Array(readFileSync(file!)));
  const base = { stage: "input", size, info };
  if (!info) done(3, { ok: false, ...base, reason: "not_a_video" });
  if (info!.container === "webm") done(3, { ok: false, ...base, reason: "webm_not_converted" });
  if (info!.seconds === null) done(3, { ok: false, ...base, reason: "length_unreadable" });
  if (!heroVideoFits(info!.seconds)) done(3, { ok: false, ...base, reason: "too_long" });
  if (info!.codec !== "hevc" && info!.codec !== "h264")
    done(3, { ok: false, ...base, reason: "codec_not_allowed" });
  done(0, { ok: true, ...base });
}

if (mode === "probe") {
  const j = JSON.parse(readFileSync(args[0]!, "utf8"));
  const v = (j.streams ?? [])[0] ?? {};
  const refuse = (reason: string) => {
    console.log(`REFUSE=${reason}`);
    process.exit(3);
  };
  if (v.codec_name !== "hevc" && v.codec_name !== "h264") refuse("codec_not_allowed");
  const w = Number(v.width),
    h = Number(v.height);
  if (!(w > 0 && h > 0)) refuse("no_dimensions");
  if (Math.max(w, h) > MAX_LONG || Math.min(w, h) > MAX_SHORT) refuse("dimensions_too_big");
  const fps = Math.max(rate(v.r_frame_rate), rate(v.avg_frame_rate));
  const frames = Number(v.nb_frames ?? 0);
  if (fps > MAX_FPS + 0.5) refuse("fps_too_high");
  if (frames > MAX_FRAMES) refuse("too_many_frames");
  const rot =
    (v.side_data_list ?? []).find((s: { rotation?: number }) => "rotation" in s)?.rotation ?? 0;
  const quarter = Math.abs(Math.round(Number(rot) / 90)) % 2 === 1;
  const dw = quarter ? h : w,
    dh = quarter ? w : h; // displayed size (ffmpeg autorotates)
  const [bw, bh] = dw >= dh ? [BOX_LONG, BOX_SHORT] : [BOX_SHORT, BOX_LONG];
  const s = Math.min(1, bw / dw, bh / dh); // never upscale
  const even = (x: number) => Math.max(2, 2 * Math.round(x / 2));
  const trc = String(v.color_transfer ?? "");
  const hdr = trc === "arib-std-b67" || trc === "smpte2084";
  const wide = !hdr && String(v.color_primaries ?? "") === "bt2020";
  console.log(
    [
      `CODEC=${v.codec_name}`,
      `SRC_W=${w}`,
      `SRC_H=${h}`,
      `ROTATED=${quarter ? 1 : 0}`,
      `OUT_W=${even(dw * s)}`,
      `OUT_H=${even(dh * s)}`,
      `FPS_CAP=${fps > OUT_FPS + 0.5 ? 1 : 0}`,
      `SRC_FPS=${Math.round(fps * 1000) / 1000}`,
      `FRAMES=${frames}`,
      `HDR=${hdr ? trc : "none"}`,
      `WIDE=${wide ? 1 : 0}`,
      `BITS=${String(v.pix_fmt ?? "").includes("10") ? 10 : 8}`,
    ].join("\n"),
  );
  process.exit(0);
}

if (mode === "output") {
  const [file, maxBytesArg, probeJson] = args;
  const size = statSync(file!).size;
  const bytes = new Uint8Array(readFileSync(file!));
  const info = videoInfo(bytes);
  const order = topLevel(bytes);
  const j = JSON.parse(readFileSync(probeJson!, "utf8"));
  const streams: Record<string, unknown>[] = j.streams ?? [];
  const v = streams[0] ?? {};
  const w = Number(v.width),
    h = Number(v.height);
  const problems: string[] = [];
  if (size > Number(maxBytesArg)) problems.push("too_big");
  if (!info || info.container !== "mp4") problems.push("not_mp4");
  if (info?.codec !== "h264") problems.push("parser_codec_not_h264");
  if (!heroVideoFits(info?.seconds)) problems.push("parser_length_not_ok");
  if (streams.length !== 1) problems.push("extra_streams");
  if (v.codec_name !== "h264") problems.push("probe_codec_not_h264");
  if (v.pix_fmt !== "yuv420p") problems.push("not_yuv420p");
  if (!["High", "Main", "Constrained Baseline"].includes(String(v.profile)))
    problems.push("profile");
  if (Math.max(w, h) > BOX_LONG || Math.min(w, h) > BOX_SHORT) problems.push("too_large");
  if (rate(String(v.avg_frame_rate)) > OUT_FPS + 0.5) problems.push("fps");
  if (Number(v.nb_frames ?? 0) > OUT_MAX_FRAMES) problems.push("frames");
  if (!(Number(j.format?.duration) <= LIMIT_S)) problems.push("probe_length_not_ok");
  if (order.indexOf("moov") < 0 || order.indexOf("moov") > order.indexOf("mdat"))
    problems.push("not_faststart");
  const tags = Object.keys(j.format?.tags ?? {}).filter(
    (k) => !["major_brand", "minor_version", "compatible_brands", "encoder"].includes(k),
  );
  if (tags.length) problems.push(`metadata:${tags.join(",")}`);
  done(problems.length ? 5 : 0, {
    ok: problems.length === 0,
    stage: "output",
    size,
    info,
    width: w,
    height: h,
    fps: v.avg_frame_rate,
    frames: Number(v.nb_frames ?? 0),
    profile: v.profile,
    probeSeconds: Number(j.format?.duration),
    boxes: order.join(">"),
    problems,
  });
}
console.error("usage: gate.ts input|probe|output …");
process.exit(2);
